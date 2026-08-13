import { NextRequest, NextResponse } from "next/server";
import {
  resolveComposeProjectPath, shQuote,
  getActiveVps, getDockerComposeCommand,
  buildManagedComposeInvocation, getImageDigest,
  getPreviousDeploymentDigest, computeChangedFields, resolveComposeFile,
} from "@/lib/vps";
import { execDetachedOnTarget, execOnTargetStrict } from "@/lib/host-exec";
import { ensureGithubRegistryLogin } from "@/lib/github-registry";
import { parseComposeServices } from "@/lib/project-scan";
import {
  buildDetachedComposeRedeployCommand,
  buildDeploymentVerificationCommand,
  buildRuntimeImageVerificationCommand,
  expectedComposeImages,
  normalizeDeploymentVerificationChecks,
  normalizePublicEndpointUrl,
} from "@/lib/compose-redeploy";
import { MANAGED_IMAGE_OVERRIDE_FILE } from "@/lib/compose-management";
import {
  composeProjectCandidates,
  requestedComposePathForCandidate,
  type ComposeProjectTarget,
} from "@/lib/redeploy-target";
import { prisma } from "@/lib/prisma";
import { applyEnvToDeployment, MissingDeploymentEnvError } from "@/lib/env-management";
import { reconcileManagedEnvironmentForRedeploy } from "@/lib/managed-environment-redeploy";
import { resolveTemplateDeploymentTarget } from "@/lib/template-deployment-state";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { validateSafePath } from "@/lib/host-safety";

function normalizePath(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isValidProjectSlug(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function validateRequestedComposePath(projectPath: string, composePath: string): string | null {
  if (!composePath) return null;
  const pathError = validateSafePath(composePath);
  if (pathError) return pathError;
  if (!composePath.startsWith(`${projectPath}/`)) return "Compose file must live inside the deployment folder.";
  if (!/\.ya?ml$/i.test(composePath)) return "Compose file must be a YAML file.";
  return null;
}

function isManagedEnvironmentPreparationError(output: string): boolean {
  return output.includes("[groundcontrol] managed environment");
}

function effectiveComposeError(output: string): HttpError {
  const detail = output.trim().slice(0, 500);
  if (isManagedEnvironmentPreparationError(detail)) {
    return new HttpError(
      "GroundControl could not prepare this deployment's managed environment. No deployment changes were applied. Retry the deploy; if it persists, verify host access in Settings.",
      409,
      { code: "DEPLOYMENT_ENV_PREPARATION_FAILED" }
    );
  }
  return new HttpError(
    `Effective Compose configuration is invalid: ${detail || "configuration could not be resolved"}`,
    400
  );
}

function normalizeGitRemoteUrl(value: string | null | undefined): string | null {
  const text = String(value || "").trim().replace(/\.git$/i, "");
  if (!text) return null;
  const ssh = text.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
  if (ssh) return `https://github.com/${ssh[1]}`;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !url.hostname) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname.toLowerCase() === "github.com" && parts.length >= 2) {
      return `${url.origin}/${parts.slice(0, 2).join("/")}`;
    }
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function exactCommit(value: string | null | undefined): string | null {
  const text = String(value || "").trim();
  return /^[a-f0-9]{40,64}$/i.test(text) ? text : null;
}

function parseKeyValueLines(output: string) {
  const values: Record<string, string> = {};
  for (const line of output.replace(/\r\n?/g, "\n").split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    values[line.slice(0, index)] = line.slice(index + 1).trim();
  }
  return values;
}

async function resolveComposeSourceFingerprint(input: {
  project: { repoUrl?: string | null } | null;
  projectPath: string;
  composePath: string;
  expectedImages: Record<string, string>;
  imageDigest: string | null;
  vps: Awaited<ReturnType<typeof getActiveVps>>;
}) {
  const git = await execOnTargetStrict(
    [
      `cd ${shQuote(input.projectPath)}`,
      `printf 'remote=%s\\n' "$(git config --get remote.origin.url 2>/dev/null || true)"`,
      `printf 'commit=%s\\n' "$(git rev-parse HEAD 2>/dev/null || true)"`,
      `printf 'branch=%s\\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"`,
    ].join(" && "),
    input.vps
  ).catch(() => ({ stdout: "", stderr: "", code: 1 }));
  const gitValues = parseKeyValueLines(git.stdout);
  let repoUrl = normalizeGitRemoteUrl(gitValues.remote) || normalizeGitRemoteUrl(input.project?.repoUrl);
  let commitSha = exactCommit(gitValues.commit);
  const branch = gitValues.branch && gitValues.branch !== "HEAD" ? gitValues.branch : "main";

  const firstImage = Object.values(input.expectedImages).find(Boolean);
  if ((!repoUrl || !commitSha) && firstImage) {
    const labels = await execOnTargetStrict(
      `docker image inspect --format 'revision={{ index .Config.Labels "org.opencontainers.image.revision" }}\nsource={{ index .Config.Labels "org.opencontainers.image.source" }}' ${shQuote(firstImage)} 2>/dev/null || true`,
      input.vps
    ).catch(() => ({ stdout: "", stderr: "", code: 1 }));
    const labelValues = parseKeyValueLines(labels.stdout.replaceAll("<no value>", ""));
    repoUrl = repoUrl || normalizeGitRemoteUrl(labelValues.source);
    commitSha = commitSha || exactCommit(labelValues.revision);
  }

  const composeRelativePath = input.composePath.startsWith(`${input.projectPath}/`)
    ? input.composePath.slice(input.projectPath.length + 1)
    : input.composePath;

  return {
    repoUrl,
    commitSha,
    branch,
    sourceRoot: "",
    sourcePath: input.projectPath,
    composePath: input.composePath,
    composeRelativePath,
    imageDigest: input.imageDigest,
    resolvedAt: new Date().toISOString(),
  };
}

async function persistDeploymentSourceFingerprint(input: {
  projectId: number;
  projectPath: string;
  composePath: string;
  fingerprint: Awaited<ReturnType<typeof resolveComposeSourceFingerprint>>;
}) {
  const enrolled = await prisma.enrolledDeployment.findFirst({
    where: {
      OR: [
        { legacyProjectId: input.projectId },
        { sourcePath: input.projectPath },
      ],
    },
  });
  if (!enrolled) return;
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(enrolled.metadataJson || "{}") as Record<string, unknown>; } catch {}
  const existingSourceRepair = metadata.sourceRepair && typeof metadata.sourceRepair === "object"
    ? metadata.sourceRepair as Record<string, unknown>
    : {};
  metadata.sourceRepair = {
    ...existingSourceRepair,
    defaultBranch: input.fingerprint.branch || existingSourceRepair.defaultBranch || "main",
    deployedCommit: input.fingerprint.commitSha || existingSourceRepair.deployedCommit || "",
    sourceRoot: existingSourceRepair.sourceRoot || input.fingerprint.sourceRoot || "",
    daytonaEnabled: existingSourceRepair.daytonaEnabled !== false,
    daytonaConnectorId: existingSourceRepair.daytonaConnectorId || "daytona",
  };
  if (input.fingerprint.repoUrl && !metadata.manualRepoUrl) metadata.manualRepoUrl = input.fingerprint.repoUrl;
  metadata.sourceFingerprint = input.fingerprint;
  metadata.sourceFingerprintUpdatedAt = new Date().toISOString();
  await prisma.enrolledDeployment.update({
    where: { id: enrolled.id },
    data: {
      sourcePath: input.projectPath,
      composePath: input.composePath,
      metadataJson: JSON.stringify(metadata),
    },
  });
}

async function recordRedeployEvidence(
  logFile: string,
  line: string,
  vps: Awaited<ReturnType<typeof getActiveVps>>,
  reset = false
): Promise<void> {
  const command = reset
    ? `: > ${shQuote(logFile)} && chmod 600 ${shQuote(logFile)} && printf '%s\\n' ${shQuote(line)} >> ${shQuote(logFile)}`
    : `printf '%s\\n' ${shQuote(line)} >> ${shQuote(logFile)}`;
  const result = await execOnTargetStrict(command, vps);
  if (result.code !== 0) {
    throw new HttpError(result.stderr || "GroundControl could not record deployment progress.", 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    const explicitPath = searchParams.get("path");
    const requestedComposePath = normalizePath(searchParams.get("composePath"));

    if (!slug && !explicitPath) {
      return NextResponse.json({ error: "slug or path required" }, { status: 400 });
    }

    let projectPath: string;
    let source: "labels" | "config" | "path";

    if (explicitPath && explicitPath.startsWith("/")) {
      const pathError = validateSafePath(explicitPath);
      if (pathError) return NextResponse.json({ error: pathError }, { status: 400 });
      projectPath = explicitPath.replace(/\/+$/, "");
      source = "path";
    } else {
      const target = await resolveComposeProjectPath(slug as string);
      projectPath = target.projectPath;
      source = target.source;
    }

    const composePathError = validateRequestedComposePath(projectPath, requestedComposePath);
    if (composePathError) return NextResponse.json({ error: composePathError }, { status: 400 });
    const vps = await getActiveVps();
    const composePath = await resolveComposeFile(projectPath, vps, requestedComposePath || undefined);
    if (!composePath) {
      return NextResponse.json({ error: "No compose file found", projectPath }, { status: 404 });
    }
    const [result, imageOverride] = await Promise.all([
      execOnTargetStrict(`cat ${shQuote(composePath)}`, vps),
      execOnTargetStrict(`cat ${shQuote(`${projectPath}/${MANAGED_IMAGE_OVERRIDE_FILE}`)} 2>/dev/null || true`, vps),
    ]);

    if (!result.stdout.trim()) {
      return NextResponse.json({ error: "No compose file found", projectPath }, { status: 404 });
    }

    const { services, domain } = parseComposeServices(result.stdout);
    return NextResponse.json({
      services,
      domain,
      raw: result.stdout,
      projectPath,
      composePath,
      source,
      hasManagedImageOverrides: Boolean(imageOverride.stdout.trim()),
    });
  } catch (err: unknown) {
    if (err instanceof MissingDeploymentEnvError) {
      return NextResponse.json({
        success: false,
        error: "Redeploy failed: Missing required env keys for this redeploy",
        code: "MISSING_DEPLOYMENT_ENV",
        missingEnvKeys: err.missing,
      }, { status: 422 });
    }
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  let redeployLogFile: string | null = null;
  let redeployVps: Awaited<ReturnType<typeof getActiveVps>> = null;
  let redeployPhase = "prepare";
  try {
    requireAuth(req);
    const {
      projectSlug,
      projectPath: requestedPath,
      composePath: requestedComposePathValue,
      publicUrl: requestedPublicUrl,
      verificationChecks: requestedVerificationChecks,
      services,
      action,
    } = await req.json();
    if (!isValidProjectSlug(projectSlug)) {
      return NextResponse.json({ error: "A valid projectSlug is required" }, { status: 400 });
    }

    const explicitPath = typeof requestedPath === "string" ? requestedPath.replace(/\/+$/, "") : "";
    const pathError = explicitPath ? validateSafePath(explicitPath) : null;
    if (pathError) return NextResponse.json({ error: pathError }, { status: 400 });
    const requestedComposePath = normalizePath(requestedComposePathValue);
    const requestedComposePathError = requestedComposePath
      ? validateSafePath(requestedComposePath) || (!/\.ya?ml$/i.test(requestedComposePath)
        ? "Compose file must be a YAML file."
        : null)
      : null;
    if (requestedComposePathError) {
      return NextResponse.json({ error: requestedComposePathError }, { status: 400 });
    }
    const vps = await getActiveVps();
    if (action === "redeploy") {
      redeployLogFile = `/tmp/gc-redeploy-${projectSlug}.log`;
      redeployVps = vps;
      await recordRedeployEvidence(
        redeployLogFile,
        "[prepare] Deployment request accepted",
        vps,
        true
      );
    }
    const resolvedTarget = await resolveComposeProjectPath(projectSlug, undefined, vps);
    const targetCandidates = composeProjectCandidates(resolvedTarget, explicitPath);
    let target: ComposeProjectTarget | null = null;
    let composeFile: string | null = null;
    for (const candidate of targetCandidates) {
      const candidateComposePath = requestedComposePathForCandidate(
        requestedComposePath,
        candidate.projectPath
      );
      const found = await resolveComposeFile(
        candidate.projectPath,
        vps,
        candidateComposePath
      );
      if (!found) continue;
      target = candidate;
      composeFile = found;
      break;
    }
    if (!target || !composeFile) {
      throw new HttpError(
        `No Compose file was found for this deployment. Checked: ${targetCandidates.map((candidate) => candidate.projectPath).join(", ") || "no resolved deployment path"}.`,
        404
      );
    }
    if (action === "redeploy") {
      await recordRedeployEvidence(
        redeployLogFile!,
        `[target] Using ${target.projectPath} (${target.source})`,
        vps
      );
    }
    const serviceArgs = Array.isArray(services) && services.length > 0
      ? services.map((s: string) => shQuote(s)).join(" ")
      : "";
    const project = await prisma.project.findFirst({
      where: {
        OR: [
          { slug: projectSlug },
          { path: target.projectPath },
        ],
      },
    });
    const recentReleaseUrls = project
      ? await prisma.deployment.findMany({
          where: { projectId: project.id },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { publicUrl: true, previewUrl: true },
        })
      : [];
    const publicUrl = [
      requestedPublicUrl,
      project?.domain,
      ...recentReleaseUrls.flatMap((release) => [release.publicUrl, release.previewUrl]),
    ].map(normalizePublicEndpointUrl).find((url): url is string => Boolean(url)) || null;
    const verificationChecks = normalizeDeploymentVerificationChecks(publicUrl, requestedVerificationChecks);

    if (action !== "redeploy") {
      if (["start", "recreate", "restart"].includes(action || "start") && project) {
        await applyEnvToDeployment(
          { ...project, path: target.projectPath },
          undefined, undefined,
          { materialize: true, components: services, vps }
        );
      }

      const args =
        action === "restart"
          ? `restart${serviceArgs ? ` ${serviceArgs}` : ""}`
          : action === "recreate"
            ? `up -d --force-recreate${serviceArgs ? ` ${serviceArgs}` : ""}`
            : `up -d${serviceArgs ? ` ${serviceArgs}` : ""}`;

      let result: { stdout: string; stderr: string; code: number };
      const composeCmd = await getDockerComposeCommand(vps, execOnTargetStrict);
      const command = `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, args, composeFile)}`;

      if ((action === "recreate" || action === "start") && vps?.isLocal) {
        const logFile = `/tmp/gc-${action}-${projectSlug}.log`;
        const launch = await execDetachedOnTarget(command, logFile, vps);
        if (launch.code !== 0) {
          throw new HttpError(launch.stderr || `Could not start Compose ${action}.`, 500);
        }
        result = { stdout: `${action} initiated — running in background (log: ${logFile})`, stderr: "", code: 0 };
      } else {
        result = await execOnTargetStrict(command, vps);
      }

      return NextResponse.json({
        success: result.code === 0,
        output: result.stdout,
        error: result.code === 0 ? undefined : result.stderr || result.stdout || `Compose ${action || "start"} failed`,
        projectPath: target.projectPath,
        detached: (action === "recreate" || action === "start") && vps?.isLocal || undefined,
      });
    }

    const startedAt = Date.now();
    redeployPhase = "configuration";
    let environmentHash: string | undefined;
    if (project) {
      const reconciliation = await reconcileManagedEnvironmentForRedeploy({
        project,
        deployPath: target.projectPath,
        components: Array.isArray(services) ? services.map(String) : undefined,
        vps,
      });
      environmentHash = reconciliation.desiredHash;
      await recordRedeployEvidence(
        redeployLogFile!,
        `[configuration] action=${reconciliation.action}${reconciliation.desiredHash ? ` revision=${reconciliation.desiredHash.slice(0, 12)}` : ""}`,
        vps
      );
      if (reconciliation.mismatchedArtifacts?.length) {
        await recordRedeployEvidence(
          redeployLogFile!,
          `[configuration] reconciled=${reconciliation.mismatchedArtifacts.join(", ")}`,
          vps
        );
      }
    } else {
      await recordRedeployEvidence(
        redeployLogFile!,
        "[configuration] Using the Compose defaults",
        vps
      );
    }
    await recordRedeployEvidence(
      redeployLogFile!,
      "[configuration] Deployment configuration ready",
      vps
    );

    redeployPhase = "compose";
    await recordRedeployEvidence(
      redeployLogFile!,
      "[compose] Validating the effective Compose configuration",
      vps
    );
    const composeCmd = await getDockerComposeCommand(vps, execOnTargetStrict);
    let configCheck = await execOnTargetStrict(
      `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, "config", composeFile)}`,
      vps
    );
    if (
      project &&
      (configCheck.code !== 0 || !configCheck.stdout.trim()) &&
      isManagedEnvironmentPreparationError(configCheck.stderr || configCheck.stdout)
    ) {
      await applyEnvToDeployment(
        { ...project, path: target.projectPath },
        undefined,
        undefined,
        {
          materialize: true,
          components: Array.isArray(services) ? services : undefined,
          vps,
        }
      );
      configCheck = await execOnTargetStrict(
        `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, "config", composeFile)}`,
        vps
      );
    }
    if (configCheck.code !== 0 || !configCheck.stdout.trim()) {
      throw effectiveComposeError(configCheck.stderr || configCheck.stdout || "configuration could not be resolved");
    }
    await recordRedeployEvidence(
      redeployLogFile!,
      `[compose] Effective Compose configuration valid (${composeFile})`,
      vps
    );
    const selectedServices = Array.isArray(services) ? services.map((service) => String(service)) : undefined;
    const expectedImages = expectedComposeImages(configCheck.stdout, selectedServices);

    redeployPhase = "registry";
    await recordRedeployEvidence(
      redeployLogFile!,
      "[registry] Authenticating configured container registry",
      vps
    );
    await ensureGithubRegistryLogin(vps);
    await recordRedeployEvidence(
      redeployLogFile!,
      "[registry] Registry authentication ready",
      vps
    );
    redeployPhase = "pull";
    await recordRedeployEvidence(
      redeployLogFile!,
      "[pull] Pulling images from the effective Compose configuration",
      vps
    );
    const pullResult = await execOnTargetStrict(
      `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, `pull${serviceArgs ? ` ${serviceArgs}` : ""}`, composeFile)}`,
      vps
    );
    if (serviceArgs && pullResult.code !== 0) {
      throw new HttpError(
        `Image pull failed: ${(pullResult.stderr || pullResult.stdout || "registry rejected the image").trim().slice(0, 500)}`,
        400
      );
    }
    await recordRedeployEvidence(
      redeployLogFile!,
      pullResult.code === 0
        ? "[pull] Images resolved"
        : "[pull] Image pull completed with build-only services skipped",
      vps
    );

    redeployPhase = "recreate";
    const deployArgs = `up -d --remove-orphans --force-recreate${serviceArgs ? ` ${serviceArgs}` : ""}`;
    let result: { stdout: string; stderr: string; code: number };
    let detached = false;
    const verifyImages = buildRuntimeImageVerificationCommand(composeCmd, composeFile, expectedImages);

    if (vps?.isLocal) {
      const command = buildDetachedComposeRedeployCommand({
        projectPath: target.projectPath,
        composeCommand: composeCmd,
        composeFile,
        deployArgs,
        expectedImages,
        publicUrl,
        verificationChecks,
      });
      const logFile = redeployLogFile!;
      const launch = await execDetachedOnTarget(command, logFile, vps, { append: true });
      if (launch.code !== 0) {
        throw new HttpError(launch.stderr || "Could not start detached redeploy.", 500);
      }
      detached = true;
      result = { stdout: `Redeploy initiated — running in background (log: ${logFile})`, stderr: "", code: 0 };
    } else {
      await recordRedeployEvidence(
        redeployLogFile!,
        "[deploy] Starting Docker Compose recreation",
        vps
      );
      result = await execOnTargetStrict(
        `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, deployArgs, composeFile)}`,
        vps
      );
      if (result.code === 0) {
        const verification = await execOnTargetStrict(`cd ${shQuote(target.projectPath)} && ${verifyImages}`, vps);
        result = {
          stdout: [result.stdout, verification.stdout].filter(Boolean).join("\n"),
          stderr: verification.code === 0 ? result.stderr : verification.stderr || verification.stdout,
          code: verification.code,
        };
      }
      if (result.code === 0) {
        const publicVerification = await execOnTargetStrict(
          `cd ${shQuote(target.projectPath)} && ${buildDeploymentVerificationCommand(verificationChecks)}`,
          vps
        );
        result = {
          stdout: [result.stdout, publicVerification.stdout].filter(Boolean).join("\n"),
          stderr: publicVerification.code === 0 ? result.stderr : publicVerification.stderr || publicVerification.stdout,
          code: publicVerification.code,
        };
      }
      if (result.stdout.trim()) {
        await recordRedeployEvidence(redeployLogFile!, result.stdout.trim().slice(-8000), vps);
      }
      if (result.stderr.trim()) {
        await recordRedeployEvidence(redeployLogFile!, result.stderr.trim().slice(-8000), vps);
      }
      await recordRedeployEvidence(
        redeployLogFile!,
        result.code === 0
          ? "__GC_REDEPLOY_STATUS__=success"
          : `__GC_REDEPLOY_STATUS__=failed:${result.code || 1}`,
        vps
      );
    }

    let imageDigest: string | null = null;
    let previousDigest: string | null = null;
    let changedFields: string[] = [];

    try {
      previousDigest = await getPreviousDeploymentDigest(projectSlug);
      const serviceList = Array.isArray(services) && services.length > 0 ? services : ["web"];
      const firstService = serviceList[0];
      const containerName = `${projectSlug}-${firstService}-1`;
      if (!detached) {
        imageDigest = await getImageDigest(containerName, vps);
      }

      const prevDeploy = project
        ? await prisma.deployment.findFirst({
            where: { projectId: project.id, status: "success" },
            orderBy: { createdAt: "desc" },
            select: { imageDigest: true, envHash: true },
          })
        : null;

      changedFields = computeChangedFields(prevDeploy, { imageDigest, envHash: environmentHash });
    } catch {
      // Digest tracking is best-effort.
    }
    const sourceFingerprint = await resolveComposeSourceFingerprint({
      project,
      projectPath: target.projectPath,
      composePath: composeFile,
      expectedImages,
      imageDigest,
      vps,
    });
    if (project) {
      if (sourceFingerprint.repoUrl && !project.repoUrl) {
        await prisma.project.update({
          where: { id: project.id },
          data: { repoUrl: sourceFingerprint.repoUrl },
        }).catch(() => undefined);
      }
      await persistDeploymentSourceFingerprint({
        projectId: project.id,
        projectPath: target.projectPath,
        composePath: composeFile,
        fingerprint: sourceFingerprint,
      }).catch(() => undefined);
    }
    const sourceFingerprintLine = `__GC_SOURCE_FINGERPRINT__=${JSON.stringify(sourceFingerprint)}`;

    await prisma.deploymentLog.create({
      data: {
        projectSlug: project?.slug || projectSlug,
        status: detached ? "running" : result.code === 0 ? "success" : "failed",
        output: [
          `[validate] Effective Compose configuration OK (${composeFile})`,
          environmentHash ? `[configuration] revision=${environmentHash}` : "",
          sourceFingerprint.commitSha ? `[source] revision=${sourceFingerprint.commitSha.slice(0, 12)} repo=${sourceFingerprint.repoUrl || "unresolved"}` : "[source] revision unresolved",
          pullResult.stdout || pullResult.stderr ? `[pull]\n${pullResult.stdout || pullResult.stderr}` : "",
          result.stdout,
        ].filter(Boolean).join("\n") || null,
        error: result.stderr || null,
        durationMs: Date.now() - startedAt,
      },
    }).catch(() => undefined);

    if (project) {
      const releaseTarget = await resolveTemplateDeploymentTarget(
        prisma,
        vps?.id && vps.id > 0 ? vps.id : null,
        "compose"
      );
      await prisma.deployment.create({
        data: {
          projectId: project.id,
          targetId: releaseTarget.id,
          status: detached ? "deploying" : result.code === 0 ? "success" : "failed",
          imageTag: Object.values(expectedImages)[0] || `${projectSlug}:latest`,
          imageDigest,
          previousImageDigest: previousDigest,
          envHash: environmentHash,
          changedFields: changedFields.length > 0 ? JSON.stringify(changedFields) : null,
          publicUrl,
          output: [sourceFingerprintLine, result.stdout].filter(Boolean).join("\n") || null,
          error: result.stderr || null,
          durationMs: Date.now() - startedAt,
          branch: sourceFingerprint.branch || "main",
          commitSha: sourceFingerprint.commitSha,
        },
      }).catch(() => undefined);
    }

    return NextResponse.json({
      success: result.code === 0,
      output: result.stdout,
      error: result.code === 0 ? undefined : result.stderr || result.stdout || "Redeploy failed",
      projectPath: target.projectPath,
      composePath: composeFile,
      detached: detached || undefined,
      imageDigest: imageDigest || undefined,
      sourceFingerprint,
      environmentHash,
      changedFields: changedFields.length > 0 ? changedFields : undefined,
    });
  } catch (err: unknown) {
    if (redeployLogFile) {
      const detail = err instanceof Error ? err.message : "The deployment request failed.";
      await recordRedeployEvidence(
        redeployLogFile,
        `[failure] phase=${redeployPhase} error=${detail.slice(0, 1000)}`,
        redeployVps
      ).then(
        () => recordRedeployEvidence(redeployLogFile!, "__GC_REDEPLOY_STATUS__=failed:1", redeployVps),
        () => undefined
      ).catch(() => undefined);
    }
    if (err instanceof MissingDeploymentEnvError) {
      return NextResponse.json({
        success: false,
        error: "Redeploy failed: Missing required env keys for this redeploy",
        code: "MISSING_DEPLOYMENT_ENV",
        missingEnvKeys: err.missing,
      }, { status: 422 });
    }
    if (err instanceof HttpError) return handleApiError(err);
    const detail = err instanceof Error ? err.message : "The Compose action failed before it could start.";
    return handleApiError(new HttpError(`Redeploy failed: ${detail}`, 500, {
      code: "COMPOSE_REDEPLOY_FAILED",
      cause: err,
    }));
  }
}
