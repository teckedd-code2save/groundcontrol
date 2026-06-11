import { NextRequest, NextResponse } from "next/server";
import { execOnVps, resolveComposeProjectPath, shQuote } from "@/lib/vps";
import { parseComposeServices } from "@/lib/project-scan";

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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
