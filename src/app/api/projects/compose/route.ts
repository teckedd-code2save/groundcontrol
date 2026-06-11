import { NextRequest, NextResponse } from "next/server";
import { execOnVps, resolveComposeProjectPath, shQuote } from "@/lib/vps";

interface ComposeService {
  name: string;
  image?: string;
  build?: boolean;
  ports?: string[];
}

function parseComposeYaml(content: string): ComposeService[] {
  const services: ComposeService[] = [];
  const lines = content.split("\n");
  let inServices = false;
  let currentService: ComposeService | null = null;
  let currentIndent = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, "");
    if (line.trim().startsWith("#")) continue;

    // Detect services: section
    if (/^services:\s*$/.test(line.trim())) {
      inServices = true;
      continue;
    }

    if (!inServices) continue;

    // End of services section (new top-level key with no indent)
    const match = line.match(/^(\s*)(\w+):/);
    if (match && match[1].length === 0 && match[2] !== "services") {
      if (currentService) services.push(currentService);
      break;
    }

    // Service name (2-space indent under services:)
    const svcMatch = line.match(/^(  )([a-zA-Z0-9_-]+):/);
    if (svcMatch) {
      if (currentService) services.push(currentService);
      currentService = { name: svcMatch[2] };
      currentIndent = 2;
      continue;
    }

    if (!currentService) continue;

    // Properties under a service (4+ spaces indent)
    const propMatch = line.match(/^(\s+)(\w+):\s*(.*)/);
    if (propMatch) {
      const indent = propMatch[1].length;
      if (indent <= currentIndent) {
        // Not under current service anymore
        continue;
      }
      const key = propMatch[2];
      const value = propMatch[3].trim();
      if (key === "image") currentService.image = value;
      if (key === "build") currentService.build = true;
      if (key === "ports" && !value) {
        // ports: followed by list on next lines — skip for now
      }
    }
  }

  if (currentService) services.push(currentService);
  return services;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }

    const target = await resolveComposeProjectPath(slug);
    const projectPath = target.projectPath;

    // Try docker-compose.yml first, then docker-compose.yaml
    const result = await execOnVps(
      `cat ${shQuote(`${projectPath}/docker-compose.yml`)} 2>/dev/null || cat ${shQuote(`${projectPath}/docker-compose.yaml`)} 2>/dev/null || cat ${shQuote(`${projectPath}/compose.yml`)} 2>/dev/null || echo ""`
    );

    if (!result.stdout.trim()) {
      return NextResponse.json({ error: "No compose file found" }, { status: 404 });
    }

    const services = parseComposeYaml(result.stdout);
    return NextResponse.json({ services, raw: result.stdout, projectPath, source: target.source });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
