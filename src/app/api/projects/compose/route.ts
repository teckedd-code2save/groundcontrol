import { NextRequest, NextResponse } from "next/server";
import { execOnVps, resolveComposeProjectPath, runDockerCompose, shQuote } from "@/lib/vps";
import { parseComposeServices } from "@/lib/project-scan";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
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
    return errorResponse(err);
  }
}

/**
 * POST /api/projects/compose
 *
 * Body:
 *   projectSlug: string
 *   services?: string[]   // optional subset of services to start
 *
 * Runs `docker compose up -d` for the whole project or for the selected services.
 */
export async function POST(req: NextRequest) {
  try {
    const { projectSlug, services } = await req.json();
    if (!projectSlug) {
      return NextResponse.json({ error: "projectSlug required" }, { status: 400 });
    }

    const target = await resolveComposeProjectPath(projectSlug);
    const args =
      Array.isArray(services) && services.length > 0
        ? `up -d ${services.map((s: string) => shQuote(s)).join(" ")}`
        : "up -d";

    const result = await runDockerCompose(target.projectPath, args);

    return NextResponse.json({
      success: result.code === 0,
      output: result.stdout,
      error: result.stderr || undefined,
      projectPath: target.projectPath,
    });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
