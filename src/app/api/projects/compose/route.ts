import { NextRequest, NextResponse } from "next/server";
import {
  execOnVps, resolveComposeProjectPath, runDockerCompose, shQuote,
  execDetached, getActiveVps, getDockerComposeCommand,
  buildManagedComposeInvocation, getImageDigest,
  getPreviousDeploymentDigest, computeChangedFields,
} from "@/lib/vps";
import { parseComposeServices } from "@/lib/project-scan";
import { prisma } from "@/lib/prisma";
import { applyEnvToDeployment, MissingDeploymentEnvError } from "@/lib/env-management";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { validateSafePath } from "@/lib/host-safety";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    const explicitPath = searchParams.get("path");

    if (!slug && !explicitPath) {
      return NextResponse.json({ error: "slug or path required" }, { status: 400 });
    }

    let projectPath: string;
    let source: "labels" | "config" | "path";

    if (explicitPath && explicitPath.startsWith("/")) {
      projectPath = explicitPath.replace(/\/+$/, "");
      source = "path";
    } else {
      const target = await resolveComposeProjectPath(slug as string);
      projectPath = target.projectPath;
      source = target.source;
    }

    const result = await execOnVps(
      `cat ${shQuote(`${projectPath}/docker-compose.yml`)} 2>/dev/null || ` +
        `cat ${shQuote(`${projectPath}/docker-compose.yaml`)} 2>/dev/null || ` +
        `cat ${shQuote(`${projectPath}/compose.yml`)} 2>/dev/null || ` +
        `cat ${shQuote(`${projectPath}/compose.yaml`)} 2>/dev/null || echo ""`
    );

    if (!result.stdout.trim()) {
      return NextResponse.json({ error: "No compose file found", projectPath }, { status: 404 });
    }

    const { services, domain } = parseComposeServices(result.stdout);
    return NextResponse.json({ services, domain, raw: result.stdout, projectPath, source });
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
    const { projectSlug, projectPath: requestedPath, services, action, environmentSlug } = await req.json();
    if (!projectSlug) {
      return NextResponse.json({ error: "projectSlug required" }, { status: 400 });
    }

    const explicitPath = typeof requestedPath === "string" ? requestedPath.replace(/\/+$/, "") : "";
    const pathError = explicitPath ? validateSafePath(explicitPath) : null;
    if (pathError) return NextResponse.json({ error: pathError }, { status: 400 });
    const target = explicitPath
      ? { projectPath: explicitPath, projectSlug, source: "config" as const }
      : await resolveComposeProjectPath(projectSlug);
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
      if (action === "restart" && project) {
        // Apply env for restart too, in case env was updated since last start
        await applyEnvToDeployment(
          { ...project, path: target.projectPath },
          undefined, undefined,
          { materialize: true, components: services, environmentSlug }
        ).catch(() => undefined); // env failures shouldn't block restart
      }

      const args =
        action === "restart"
          ? `restart${serviceArgs ? ` ${serviceArgs}` : ""}`
          : action === "recreate"
            ? `up -d --force-recreate${serviceArgs ? ` ${serviceArgs}` : ""}`
            : `up -d${serviceArgs ? ` ${serviceArgs}` : ""}`;

      const startedAt = Date.now();
      let result: { stdout: string; stderr: string; code: number };

      const vps = await getActiveVps();
      if ((action === "recreate" || action === "start") && vps?.isLocal) {
        const composeCmd = await getDockerComposeCommand(vps);
        const command = `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, args)}`;
        const logFile = `/tmp/gc-${action}-${projectSlug}.log`;
        execDetached(command, logFile);
        result = { stdout: `${action} initiated — running in background (log: ${logFile})`, stderr: "", code: 0 };
      } else {
        result = await runDockerCompose(target.projectPath, args);
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
    const vps = await getActiveVps();

    // 1. Materialize env
    if (project) {
      await applyEnvToDeployment(
        { ...project, path: target.projectPath },
        undefined, undefined,
        {
          materialize: true,
          components: Array.isArray(services) ? services : undefined,
          environmentSlug: typeof environmentSlug === "string" ? environmentSlug : undefined,
        }
      );
    }

    // 2. Pre-deploy validation: check compose config
    const composeCmd = await getDockerComposeCommand(vps);
    let validationOutput = "";

    if (vps) {
      const configCheck = await execOnVps(
        `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, "config --quiet")} 2>&1`,
        vps
      );
      if (configCheck.code !== 0) {
        return NextResponse.json({
          success: false,
          error: `Compose config validation failed:\n${configCheck.stderr || configCheck.stdout}`,
          code: "COMPOSE_CONFIG_INVALID",
        }, { status: 422 });
      }
      validationOutput = configCheck.stdout;
    }

    // 3. Pull latest images (best-effort — projects with local-only images
    //    like "myapp:local" can't pull from a registry, and that's fine).
    //    Mirror CI behaviour: run pull, log output, never block on failure.
    const pullResult = await execOnVps(
      `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, `pull${serviceArgs ? ` ${serviceArgs}` : ""}`)} 2>&1; exit 0`,
      vps
    );

    // 4. Run database migrations (mirrors CI: prisma migrate deploy)
    const migrateResult = await execOnVps(
      `cd ${shQuote(target.projectPath)} && ${composeCmd} run --rm --no-deps web npx prisma migrate deploy --schema /app/db/schema.prisma 2>&1`,
      vps
    );
    // Migration failure is non-fatal for non-GroundControl projects (they may not use Prisma).
    // For GroundControl itself, migration failure means the app may crash — log it clearly.
    if (migrateResult.code !== 0) {
      console.warn(`[redeploy] prisma migrate deploy failed for ${projectSlug}: ${migrateResult.stderr || migrateResult.stdout}`);
    }

    // 5. Deploy (mirrors CI: up -d --remove-orphans)
    const deployArgs = `up -d --remove-orphans${serviceArgs ? ` ${serviceArgs}` : ""}`;
    let result: { stdout: string; stderr: string; code: number };
    let detached = false;

    if (vps?.isLocal) {
      const command = `cd ${shQuote(target.projectPath)} && ${buildManagedComposeInvocation(composeCmd, deployArgs)} && ` +
        // Health-check loop (mirrors CI: wait for healthy)
        `for i in $(seq 1 30); do ` +
        `if ${buildManagedComposeInvocation(composeCmd, `ps${serviceArgs ? ` ${serviceArgs}` : ""}`)} | grep -q healthy; then break; fi; ` +
        `sleep 2; done && ` +
        // Cleanup (mirrors CI: docker system prune -f)
        `docker system prune -f`;
      const logFile = `/tmp/gc-redeploy-${projectSlug}.log`;
      execDetached(command, logFile);
      detached = true;
      result = { stdout: `Redeploy initiated — running in background (log: ${logFile})`, stderr: "", code: 0 };
    } else {
      result = await runDockerCompose(target.projectPath, deployArgs);
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
        status: result.code === 0 ? "success" : "failed",
        output: [
          validationOutput ? `[validate] config OK` : "",
          pullResult.stdout ? `[pull]\n${pullResult.stdout}` : "",
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
          status: result.code === 0 ? "success" : "failed",
          imageTag: `${projectSlug}:latest`,
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
    const detail = err instanceof Error ? err.message : "The Compose action failed before it could start.";
    return handleApiError(new HttpError(`Redeploy failed: ${detail}`, 500, {
      code: "COMPOSE_REDEPLOY_FAILED",
      cause: err,
    }));
  }
}
