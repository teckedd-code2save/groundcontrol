import { buildOutput, buildFailureSummary, type BuildOutput } from "@/lib/build-output";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { execOnTargetStrict } from "@/lib/host-exec";
import { ensureGithubRegistryLogin, githubRegistryCredential } from "@/lib/github-registry";
import { sourceAccessForDeployment, syncGithubDeploymentSource } from "@/lib/github-source-deploy";
import {
  buildSandboxBuildScript,
  buildSandboxCloneScript,
  buildSbxCreateCommand,
  buildSbxExecCommand,
  buildSbxRmCommand,
  parseSandboxId,
} from "@/lib/docker-sandbox";
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
  buildableServiceBuildInfo,
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

function normalizeBuilder(value: unknown): "local" | "buildkit" | "docker-agentic" {
  if (value === "local") return "local";
  if (value === "docker-agentic") return "docker-agentic";
  return "buildkit";
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
  const logs: BuildOutput[] = [];
  const run = async (phase: string, ...args: Parameters<typeof execOnTargetStrict>) => {
    const result = await execOnTargetStrict(args[0], args[1], args[2], args[3], { timeout: 15 * 60 * 1000 });
    logs.push(buildOutput(phase, result));
    return result;
  };
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

    // Any enrolled deployment with a linked GitHub repository and a compose
    // path is buildable. The legacy Project / managementMode gate was removed
    // so new deployments are MCP-drivable without a manual "manage" step.
    const enrolled = await prisma.enrolledDeployment.findFirst({
      where: {
        OR: [
          { sourcePath: projectPath },
          { slug: projectSlug },
        ],
      },
      select: { id: true, composePath: true },
    });
    if (!enrolled) {
      throw new HttpError("Build is not enrolled in GroundControl.", 409);
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

    const composePath = await resolveComposeFile(projectPath, vps, enrolled.composePath);
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
        `Effective Compose configuration is invalid: ${buildFailureSummary(buildOutput("compose configuration", configCheck))}`,
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

    const testImages = async () => {
      if (!runTests) return { status: "skipped", command: null, output: null };
      const command = await resolveTestCommand(projectPath, body.testCommand, vps);
      if (!command) throw new HttpError("runTests was requested but no test command is available. Provide testCommand or a package.json `test` script.", 400);
      const registry = await ensureGithubRegistryLogin(vps);
      if (!registry.configured) throw new HttpError("A registry credential is required to test published images.", 400);
      const results: BuildOutput[] = [];
      for (const image of new Set(Object.values(refs))) {
        const result = await run(`tests ${image}`, buildRunTestsCommand(image, command), vps);
        results.push(buildOutput(`tests ${image}`, result));
      }
      return {
        status: results.every((result) => result.code === 0) ? "passed" : "failed",
        command,
        output: results.map((result) => `[${result.phase}]\n${result.stdout}\n${result.stderr}`).join("\n"),
        results,
      };
    };

    if (builder === "docker-agentic") {
      const ghcr = await githubRegistryCredential();
      if (!ghcr) {
        throw new HttpError("A GitHub container registry credential is required to push release images.", 400);
      }
      const source = await sourceAccessForDeployment(enrolled.id);
      const repoUrl = `https://github.com/${source.repository.fullName}.git`;
      let sandboxId: string | null = null;
      try {
        const create = await run("sandbox creation",
          buildSbxCreateCommand(`gc-build-${commitSha.slice(0, 8)}`),
          vps
        );
        sandboxId = parseSandboxId(create.stdout);
        if (!sandboxId) {
          throw new HttpError(
            buildFailureSummary(logs[logs.length - 1]),
            500
          );
        }

        const buildInfo = buildableServiceBuildInfo(configCheck.stdout);

        // Clone the repo once — the sandbox is reused across the image builds,
        // so a single clone (not one per service) is what feeds every build.
        const clone = await run("source clone",
          buildSbxExecCommand(sandboxId, buildSandboxCloneScript({ repoUrl, commitSha })),
          vps,
          undefined,
          `${source.token}\n`
        );
        if (clone.code !== 0) {
          throw new HttpError(
            buildFailureSummary(logs[logs.length - 1]),
            400
          );
        }

        // Build each unique image ref once — multiple services can share one
        // image (e.g. an api + migrate + worker all build the same backend).
        const digestByRef = new Map<string, string | null>();
        for (const service of services) {
          const ref = refs[service];
          if (digestByRef.has(ref)) continue;
          const info = buildInfo[service];
          // The effective compose config resolves build paths to absolute paths
          // on the VPS (e.g. /opt/agent-flow/RentAWeekend/rentweekend-backend).
          // Relativize them against the project path so the sandbox (which
          // clones to /tmp/repo) can resolve them.
          let context = info?.context;
          if (context && context.startsWith(projectPath)) {
            context = context.slice(projectPath.length).replace(/^\/+/, "") || ".";
          }
          let dockerfile = info?.dockerfile;
          if (dockerfile && info?.context && dockerfile.startsWith(info.context)) {
            dockerfile = dockerfile.slice(info.context.length).replace(/^\/+/, "");
          }
          const script = buildSandboxBuildScript({
            ref,
            username: ghcr.username,
            context,
            dockerfile,
          });
          const result = await run("sandbox build",
            buildSbxExecCommand(sandboxId, script),
            vps,
            undefined,
            `${ghcr.token}\n`
          );
          if (result.code !== 0) {
            throw new HttpError(
              buildFailureSummary(logs[logs.length - 1]),
              400
            );
          }
          const digest = result.stdout.trim().split("\n").filter(Boolean).pop() || null;
          digestByRef.set(ref, digest);
        }

        const images = services.map((service) => ({
          service,
          ref: refs[service],
          digest: digestByRef.get(refs[service]) || null,
        }));

        return NextResponse.json({
          success: true,
          commitSha,
          images,
          tests: await testImages(),
          logs,
          builder,
          commit: sourceSync.commitSha,
        });
      } finally {
        if (sandboxId) {
          await execOnTargetStrict(buildSbxRmCommand(sandboxId), vps).catch(() => undefined);
        }
      }
    }

    const previousOverride = await execOnTargetStrict(
      `cat ${shQuote(`${projectPath}/${MANAGED_IMAGE_OVERRIDE_FILE}`)} 2>/dev/null || true`,
      vps
    );
    const write = await run("write build image configuration", writeOverrideCommand(projectPath, overrideContent), vps);
    if (write.code !== 0) {
      throw new HttpError(write.stderr || "Could not write the build image override.", 500);
    }

    try {
      const registry = await ensureGithubRegistryLogin(vps);
      if (!registry.configured) {
        throw new HttpError("A GitHub container registry credential is required to build images.", 400);
      }

      if (builder === "buildkit") {
        const ensureBuilder = await run("builder preparation",
          buildEnsureBuildkitBuilderCommand("gc-buildkit", "2", "2g"),
          vps
        );
        if (ensureBuilder.code !== 0) {
          throw new HttpError(
            buildFailureSummary(logs[logs.length - 1]),
            400
          );
        }
      }

      const buildPushCommand = builder === "buildkit"
        ? buildBuildkitBuildPushCommand({ projectPath, composeFile: composePath, builder: "gc-buildkit", refs, buildInfo: buildableServiceBuildInfo(configCheck.stdout) })
        : buildReleaseBuildPushCommand({ projectPath, composeCommand: composeCmd, composeFile: composePath, services });
      const buildPush = await run("build and publish", buildPushCommand, vps);
      if (buildPush.code !== 0) {
        throw new HttpError(
          buildFailureSummary(logs[logs.length - 1]),
          400
        );
      }

      const verify = await run("registry verification", buildReleaseVerifyCommand(refs), vps);
      if (verify.code !== 0) {
        throw new HttpError(
          buildFailureSummary(logs[logs.length - 1]),
          400
        );
      }
      const images = parseReleaseVerifyOutput(verify.stdout, refs);

      const tests = await testImages();

      return NextResponse.json({
        success: true,
        commitSha,
        images,
        tests,
        logs,
        builder,
        commit: sourceSync.commitSha,
      });
    } finally {
      // A build never leaves the running configuration changed: restore the
      // prior override regardless of the outcome.
      const restored = await run("restore image configuration",
        writeOverrideCommand(projectPath, previousOverride.stdout || ""), vps
      );
      if (restored.code !== 0) throw new HttpError(buildFailureSummary(logs[logs.length - 1]), 500);
    }
  } catch (error) {
    const response = handleApiError(error);
    const body = await response.json();
    return NextResponse.json({ ...body, logs }, { status: response.status });
  }
}
