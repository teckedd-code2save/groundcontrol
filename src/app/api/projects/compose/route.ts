import { NextRequest, NextResponse } from "next/server";
import { execOnVps, resolveComposeProjectPath, runDockerCompose, shQuote } from "@/lib/vps";
import { parseComposeServices } from "@/lib/project-scan";
import { prisma } from "@/lib/prisma";
import { applyEnvToDeployment } from "@/lib/env-management";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    // Nested projects (e.g. agent-flow/RentAWeekend) can't be resolved by slug
    // alone, so the scanner-provided absolute `path` takes precedence.
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

    // Try every supported compose filename in order.
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
    return handleApiError(err);
  }
}

/**
 * POST /api/projects/compose
 *
 * Body:
 *   projectSlug: string
 *   services?: string[]   // optional subset of services to start/restart
 *   action?: "start" | "restart" | "redeploy"
 *
 * Runs compose lifecycle actions for the whole project or selected services.
 * Redeploy materializes saved env first and force-recreates the service scope.
 */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const { projectSlug, services, action } = await req.json();
    if (!projectSlug) {
      return NextResponse.json({ error: "projectSlug required" }, { status: 400 });
    }

    const target = await resolveComposeProjectPath(projectSlug);
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
    if (action === "redeploy" && project) {
      await applyEnvToDeployment(project, undefined, undefined, { materialize: true });
    }

    const args =
      action === "restart"
        ? `restart${serviceArgs ? ` ${serviceArgs}` : ""}`
        : action === "redeploy"
          ? `up -d --force-recreate${serviceArgs ? ` ${serviceArgs}` : ""}`
          : `up -d${serviceArgs ? ` ${serviceArgs}` : ""}`;

    const result = await runDockerCompose(target.projectPath, args);

    return NextResponse.json({
      success: result.code === 0,
      output: result.stdout,
      error: result.stderr || undefined,
      projectPath: target.projectPath,
    });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
