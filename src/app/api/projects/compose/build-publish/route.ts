import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { execOnTargetStrict } from "@/lib/host-exec";
import { ensureGithubRegistryLogin } from "@/lib/github-registry";
import { syncGithubDeploymentSource } from "@/lib/github-source-deploy";
import {
  buildManagedComposeInvocation,
  getActiveVps,
  getDockerComposeCommand,
  resolveComposeFile,
  resolveComposeProjectPath,
  shQuote,
} from "@/lib/vps";
import { MANAGED_IMAGE_OVERRIDE_FILE } from "@/lib/compose-management";
import {
  buildableServiceImages,
  buildBuildkitBuildPushCommand,
  buildEnsureBuildkitBuilderCommand,
  buildReleaseBuildPushCommand,
  buildReleaseImageOverride,
  buildReleaseVerifyCommand,
  buildRunTestsCommand,
  normalizeReleaseSha,
  normalizeTestCommand,
  parseReleaseVerifyOutput,
} from "@/lib/github-image-release";
import { prisma } from "@/lib/prisma";

function isValidProjectSlug(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function writeOverrideCommand(projectPath: string, content: string): string {
  const target = `${projectPath}/${MANAGED_IMAGE_OVERRIDE_FILE}`;
  if (!content.trim()) return `rm -f ${shQuote(target)}`;
  const encoded = Buffer.from(content, "utf8").toString("base64");
  return [
    "set -eu",
    `mkdir -p ${shQuote(`${projectPath}/.groundcontrol`)}`,
    `printf '%s' ${shQuote(encoded)} | base64 -d > ${shQuote(`${target}.new`)}`,
    `chmod 600 ${shQuote(`${target}.new`)}`,
    `mv ${shQuote(`${target}.new`)} ${shQuote(target)}`,
  ].join("\n");
}

function normalizeBuilder(value: unknown): "local" | "buildkit" {
  return value === "local" ? "local" : "buildkit";
}

/** Resolve a test command: explicit input → package.json `test` script. */
async function resolveTestCommand(
  projectPath: string,
  explicit: unknown,
  vps: Awaited<ReturnType<typeof getActiveVps>>
): Promise<string | null> {
  const fromExplicit = normalizeTestCommand(explicit);
  if (fromExplicit) return fromExplicit;
  const read = await execOnTargetStrict(
    `cd ${shQuote(projectPath)} && node -p "try{require('./package.json').scripts&&require('./package.json').scripts.test||''}catch(e){''}" 2>/dev/null || true`,
    vps
  );
  return normalizeTestCommand(read.stdout.trim()) || null;
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const projectSlug = String(body.projectSlug || "");
    if (!isValidProjectSlug(projectSlug)) {
      throw new HttpError("A valid projectSlug is required", 400);
    }
    const commitSha = normalizeReleaseSha(body.commitSha);
    const branch = typeof body.branch === "string" && body.branch.trim()
      ? body.branch.trim()
      : undefined;
    const builder = normalizeBuilder(body.builder);
    const runTests = body.runTests === true;
    const requestedServices: string[] | undefined = Array.isArray(body.services)
      ? body.services.map((s: unknown) => String(s)).filter(Boolean)
      : undefined;

    const vps = await getActiveVps();
    const resolved = await resolveComposeProjectPath(projectSlug, undefined, vps);
    const projectPath = resolved.projectPath;

    const project = await prisma.project.findFirst({
      where: { OR: [{ slug: projectSlug }, { path: projectPath }] },
    });
    if (!project) {
      throw new HttpError("Build requires a managed GroundControl project.", 409);
    }
    const enrolled = await prisma.enrolledDeployment.findFirst({
      where: {
        OR: [
          { legacyProjectId: project.id },
          { sourcePath: projectPath },
          { slug: projectSlug },
        ],
      },
      select: { id: true, managementMode: true },
    });
    if (!enrolled) {
      throw new HttpError("Build is not enrolled in GroundControl.", 409);
    }
    if (enrolled.managementMode !== "managed") {
      throw new HttpError("Build requires managementMode=managed.", 409);
    }

    const sourceSync = await syncGithubDeploymentSource({
      deploymentId: enrolled.id,
      projectPath,
      branch,
      sha: commitSha,
      vps,
    });
    if (sourceSync.commitSha.toLowerCase() !== commitSha) {
      throw new HttpError(
        `Source sync landed on ${sourceSync.commitSha.slice(0, 12)}, expected ${commitSha.slice(0, 12)}.`,
        409
      );
    }

    const composePath = await resolveComposeFile(projectPath, vps);
    if (!composePath) {
      throw new HttpError("The synced source does not contain a Compose file.", 409);
    }
    const composeCmd = await getDockerComposeCommand(vps, execOnTargetStrict);

    const configCheck = await execOnTargetStrict(
      `cd ${shQuote(projectPath)} && ${buildManagedComposeInvocation(composeCmd, "config", composePath, { includeEnvironment: false })}`,
      vps
    );
    if (configCheck.code !== 0 || !configCheck.stdout.trim()) {
      throw new HttpError(
        `Effective Compose configuration is invalid: ${(configCheck.stderr || configCheck.stdout).trim().slice(0, 500)}`,
        400
      );
    }
    const buildable = buildableServiceImages(configCheck.stdout);
    if (requestedServices?.length) {
      const missing = requestedServices.filter((s) => !(s in buildable));
      if (missing.length) {
        throw new HttpError(
          `Requested services are not buildable: ${missing.join(", ")}.`,
          400
        );
      }
      for (const name of Object.keys(buildable)) {
        if (!requestedServices.includes(name)) delete buildable[name];
      }
    }
    const { content: overrideContent, refs } = buildReleaseImageOverride(buildable, commitSha);
    const services = Object.keys(refs);

    const previousOverride = await execOnTargetStrict(
      `cat ${shQuote(`${projectPath}/${MANAGED_IMAGE_OVERRIDE_FILE}`)} 2>/dev/null || true`,
      vps
    );
    const write = await execOnTargetStrict(writeOverrideCommand(projectPath, overrideContent), vps);
    if (write.code !== 0) {
      throw new HttpError(write.stderr || "Could not write the build image override.", 500);
    }

    try {
      const registry = await ensureGithubRegistryLogin(vps);
      if (!registry.configured) {
        throw new HttpError("A GitHub container registry credential is required to build images.", 400);
      }

      if (builder === "buildkit") {
        const ensureBuilder = await execOnTargetStrict(
          buildEnsureBuildkitBuilderCommand("gc-buildkit", "2", "2g"),
          vps
        );
        if (ensureBuilder.code !== 0) {
          throw new HttpError(
            `BuildKit builder could not be prepared: ${(ensureBuilder.stderr || ensureBuilder.stdout).trim().slice(0, 500)}`,
            400
          );
        }
      }

      const buildPushCommand = builder === "buildkit"
        ? buildBuildkitBuildPushCommand({ projectPath, composeFile: composePath, builder: "gc-buildkit", refs })
        : buildReleaseBuildPushCommand({ projectPath, composeCommand: composeCmd, composeFile: composePath, services });
      const buildPush = await execOnTargetStrict(buildPushCommand, vps);
      if (buildPush.code !== 0) {
        throw new HttpError(
          `Build or push failed: ${(buildPush.stderr || buildPush.stdout).trim().slice(0, 1500)}`,
          400
        );
      }

      const verify = await execOnTargetStrict(buildReleaseVerifyCommand(refs), vps);
      if (verify.code !== 0) {
        throw new HttpError(
          `Build verification failed: ${(verify.stderr || verify.stdout).trim().slice(0, 1500)}`,
          400
        );
      }
      const images = parseReleaseVerifyOutput(verify.stdout, refs);

      // Optional tests: run against the freshly built image in a throwaway
      // container. A non-zero exit marks the build as tests-failed so a later
      // release refuses to promote it.
      let tests: { status: "passed" | "failed" | "skipped"; command: string | null; output: string | null } = {
        status: "skipped",
        command: null,
        output: null,
      };
      if (runTests) {
        const testCommand = await resolveTestCommand(projectPath, body.testCommand, vps);
        if (!testCommand) {
          throw new HttpError(
            "runTests was requested but no test command is available. Provide testCommand or a package.json `test` script.",
            400
          );
        }
        const firstImage = refs[services[0]];
        const testRun = await execOnTargetStrict(buildRunTestsCommand(firstImage, testCommand), vps);
        tests = {
          status: testRun.code === 0 ? "passed" : "failed",
          command: testCommand,
          output: (testRun.stdout || testRun.stderr || "").trim().slice(0, 4000),
        };
      }

      return NextResponse.json({
        success: true,
        commitSha,
        images,
        tests,
        builder,
        commit: sourceSync.commitSha,
      });
    } catch (error) {
      await execOnTargetStrict(
        writeOverrideCommand(projectPath, previousOverride.stdout || ""),
        vps
      ).catch(() => undefined);
      throw error;
    } finally {
      // A build never leaves the running configuration changed: restore the
      // prior override regardless of the outcome.
      await execOnTargetStrict(
        writeOverrideCommand(projectPath, previousOverride.stdout || ""),
        vps
      ).catch(() => undefined);
    }
  } catch (error) {
    return handleApiError(error);
  }
}
