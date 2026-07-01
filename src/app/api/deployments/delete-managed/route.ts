import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execOnVps, getActiveVps, getSystemConfig, shQuote } from "@/lib/vps";
import { handleApiError } from "@/lib/errors";

function normalizeRoot(value: string): string {
  return value.replace(/\/+$/, "") || "/";
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const deploymentPath = String(body.path || "").replace(/\/+$/, "");
    const deleteVolumes = body.deleteVolumes === true;

    if (!deploymentPath.startsWith("/")) {
      return NextResponse.json({ error: "path must be an absolute VPS path" }, { status: 400 });
    }

    const config = await getSystemConfig();
    const managedRoot = normalizeRoot(config.templateDeploymentRoot || "/srv/groundcontrol/deployments");
    const isManaged = deploymentPath !== managedRoot && deploymentPath.startsWith(`${managedRoot}/`);
    const force = body.force === true;

    if (!isManaged && !force) {
      // For non-managed paths, still allow deletion if force is set
      // but verify it's a real project directory with a compose file
      const vps = await getActiveVps();
      const check = await execOnVps(`test -f ${shQuote(`${deploymentPath}/docker-compose.yml`)} && echo yes || echo no`, vps);
      if (check.stdout.trim() !== "yes") {
        return NextResponse.json({
          error: `No docker-compose.yml found at ${deploymentPath}. Not a deployment directory.`,
        }, { status: 400 });
      }
    }

    const vps = await getActiveVps();
    const result = await execOnVps(
      [
        `set -u`,
        `dir=${shQuote(deploymentPath)}`,
        `if [ ! -d "$dir" ]; then echo "Deployment path does not exist: $dir" >&2; exit 2; fi`,
        `compose_cmd=""`,
        `if docker compose version >/dev/null 2>&1; then compose_cmd="docker compose"; elif command -v docker-compose >/dev/null 2>&1; then compose_cmd="docker-compose"; fi`,
        `if [ -n "$compose_cmd" ]; then cd "$dir" && $compose_cmd down ${deleteVolumes ? "-v" : ""} >/tmp/gc-delete-compose.log 2>&1 || cat /tmp/gc-delete-compose.log >&2; fi`,
        `rm -rf "$dir"`,
        `printf 'Deleted %s' "$dir"`,
      ].join("\n"),
      vps
    );

    if (result.code !== 0) {
      return NextResponse.json({ error: result.stderr || result.stdout || "Delete failed" }, { status: 400 });
    }

    return NextResponse.json({ success: true, output: result.stdout, path: deploymentPath });
  } catch (err) {
    return handleApiError(err);
  }
}
