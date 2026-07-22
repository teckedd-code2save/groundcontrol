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
  buildRuntimeImageVerificationCommand,
  expectedComposeImages,
} from "@/lib/compose-redeploy";
import { MANAGED_IMAGE_OVERRIDE_FILE } from "@/lib/compose-management";
import { prisma } from "@/lib/prisma";
import { applyEnvToDeployment, MissingDeploymentEnvError } from "@/lib/env-management";
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

function effectiveComposeError(output: string): HttpError {
  const detail = output.trim().slice(0, 500);
  if (detail.includes("[groundcontrol] managed environment")) {
    return new HttpError(
      "This environment has vault values but its runtime files are not materialized. Open Environment and deploy the selected environment again.",
      409,
      { code: "ENV_RUNTIME_NOT_MATERIALIZED" }
    );
  }
  return new HttpError(
    `Effective Compose configuration is invalid: ${detail || "configuration could not be resolved"}`,
    400
  );
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

/**
 * POST /api/projects/compose
 *
 * Body:
 *   projectSlug: string
 *   services?: string[]   // optional subset of services
 *   action?: "start" | "restart" | "redeploy" | "recreate"
 *
 * Actions:
 *   start   — docker compose up -d
 *   restart — docker compose restart
 *   redeploy — docker compose config → pull → up -d --force-recreate
 *              (validates compose, pulls latest image, force recreates,
 *               records image digest, probes post-deploy health)
 *   recreate — docker compose up -d --force-recreate (no pull, old redeploy)
 *   stop    — handled by separate compose-down endpoint
 */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const {
      projectSlug,
      projectPath: requestedPath,
      composePath: requestedComposePathValue,
      services,
      action,
      environmentSlug,
    } = await req.json();
    if (!isValidProjectSlug(projectSlug)) {
      return NextResponse.json({ error: "A valid projectSlug is required" }, { status: 400 });
    }

    const explicitPath = typeof requestedPath === "string" ? requestedPath.replace(/\/+$/, "") : "";
    const pathError = explicitPath ? validateSafePath(explicitPath) : null;
    if (pathError) return NextResponse.json({ error: pathError }, { status: 400 });
    const target = explicitPath
      ? { projectPath: explicitPath, projectSlug, source: "config" as const }
      : await resolveComposeProjectPath(projectSlug);
    const requestedComposePath = normalizePath(requestedComposePathValue);
    const composePathError = validateRequestedComposePath(target.projectPath, requestedComposePath);
    if (composePathError) return NextResponse.json({ error: composePathError }, { status: 400 });
    const vps = await getActiveVps();
    const composeFile = await resolveComposeFile(target.projectPath, vps, requestedComposePath || undefined);
    if (!composeFile) {
      return NextResponse.json({ error: "No Compose file was found for this deployment." }, { status: 404 });
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

    // --- Start / Restart / Recreate (non-redeploy actions) ---

    if (action !== "redeploy") {
      if (["start", "recreate", "restart"].includes(action || "start") && project) {
        // Keep the selected vault environment materialized before any Compose
        // lifecycle action. A host restart can legitimately clear /run.
        await applyEnvToDeployment(
          { ...project, path: target.projectPath },
          undefined, undefined,
          { materialize: true, components: services, environmentSlug, vps }
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

    // ============================
    // REDEPLOY: validate → pull → recreate → record → probe
    // ============================

    const startedAt = Date.now();
    // 1. Materialize env
    if (project) {
      await applyEnvToDeployment(
        { ...project, path: target.projectPath },
        undefined, undefined,
        {
          materialize: true,
          components: Array.isArray(services) ? services : undefined,
          environmentSlug: typeof environmentSlug === "string" ? environmentSlug : undefined,
          vps,
        }
      );
    }

    // 2. Resolve the exact effective model once. Pull, recreation and runtime
    //    verification below all use this same base file and managed overrides.
    const composeCmd = await getDockerComposeCommand(vps, execOnTargetStrict);
    const configCheck = await execOnTargetStrict(
      `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, "config", composeFile)}`,
      vps
    );
    if (configCheck.code !== 0 || !configCheck.stdout.trim()) {
      throw effectiveComposeError(configCheck.stderr || configCheck.stdout || "configuration could not be resolved");
    }
    const selectedServices = Array.isArray(services) ? services.map((service) => String(service)) : undefined;
    const expectedImages = expectedComposeImages(configCheck.stdout, selectedServices);

    // 3. Pull from that same effective model. Targeted image changes must pull
    //    successfully; full redeploys remain tolerant of build-only services.
    await ensureGithubRegistryLogin(vps);
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

    // 4. A pull is not a deployment. Force recreation so the running container
    //    cannot retain the previous :local image.
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
      });
      const logFile = `/tmp/gc-redeploy-${projectSlug}.log`;
      await execOnTargetStrict(`: > ${shQuote(logFile)} && chmod 600 ${shQuote(logFile)}`, vps);
      const launch = await execDetachedOnTarget(command, logFile, vps);
      if (launch.code !== 0) {
        throw new HttpError(launch.stderr || "Could not start detached redeploy.", 500);
      }
      detached = true;
      result = { stdout: `Redeploy initiated — running in background (log: ${logFile})`, stderr: "", code: 0 };
    } else {
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
    }

    // 5. Record image digest for rollback tracking
    let imageDigest: string | null = null;
    let previousDigest: string | null = null;
    let changedFields: string[] = [];

    try {
      previousDigest = await getPreviousDeploymentDigest(projectSlug);

      // Get digest from the first service container (or project-wide)
      const serviceList = Array.isArray(services) && services.length > 0 ? services : ["web"];
      const firstService = serviceList[0];
      const containerName = `${projectSlug}-${firstService}-1`;

      // Give the container a moment to start if detached
      if (!detached) {
        imageDigest = await getImageDigest(containerName, vps);
      }
      // For detached mode, we'll record a placeholder — the digest can be
      // fetched later when the user refreshes

      // Compute what changed
      const prevDeploy = project
        ? await prisma.deployment.findFirst({
            where: { projectId: project.id, status: "success" },
            orderBy: { createdAt: "desc" },
            select: { imageDigest: true, envHash: true },
          })
        : null;

      changedFields = computeChangedFields(prevDeploy, { imageDigest, envHash: undefined });
    } catch {
      // Digest tracking is best-effort — deploy shouldn't fail if it breaks
    }

    // 6. Record deployment log with digest info
    await prisma.deploymentLog.create({
      data: {
        projectSlug: project?.slug || projectSlug,
        status: detached ? "running" : result.code === 0 ? "success" : "failed",
        output: [
          `[validate] Effective Compose configuration OK (${composeFile})`,
          pullResult.stdout || pullResult.stderr ? `[pull]\n${pullResult.stdout || pullResult.stderr}` : "",
          result.stdout,
        ].filter(Boolean).join("\n") || null,
        error: result.stderr || null,
        durationMs: Date.now() - startedAt,
      },
    }).catch(() => undefined);

    // If project exists, create a Deployment record with digest tracking
    if (project) {
      await prisma.deployment.create({
        data: {
          projectId: project.id,
          targetId: (await prisma.deploymentTarget.findFirst({
            where: { type: { in: ["compose", "docker-compose"] } },
          }))?.id ?? 1,
          status: detached ? "deploying" : result.code === 0 ? "success" : "failed",
          imageTag: Object.values(expectedImages)[0] || `${projectSlug}:latest`,
          imageDigest: imageDigest,
          previousImageDigest: previousDigest,
          changedFields: changedFields.length > 0 ? JSON.stringify(changedFields) : null,
          output: result.stdout || null,
          error: result.stderr || null,
          durationMs: Date.now() - startedAt,
          branch: "main",
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
      changedFields: changedFields.length > 0 ? changedFields : undefined,
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
    if (err instanceof HttpError) return handleApiError(err);
    const detail = err instanceof Error ? err.message : "The Compose action failed before it could start.";
    return handleApiError(new HttpError(`Redeploy failed: ${detail}`, 500, {
      code: "COMPOSE_REDEPLOY_FAILED",
      cause: err,
    }));
  }
}
