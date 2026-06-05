import { NextRequest, NextResponse } from "next/server";
import { execOnVps, resolveBinary, getSystemConfig } from "@/lib/vps";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const config = await getSystemConfig();

    const caddyBin = await resolveBinary("caddy");
    const nginxBin = await resolveBinary("nginx");

    // Detect init system: systemd vs OpenRC vs none
    const hasSystemd = await execOnVps("which systemctl 2>/dev/null || echo ''");
    const hasOpenRC = await execOnVps("which rc-service 2>/dev/null || echo ''");
    const initSystem = hasSystemd.stdout.trim() ? "systemd" : hasOpenRC.stdout.trim() ? "openrc" : "none";

    // Caddy status — try multiple methods
    let caddyActive = false;
    let caddyVersion = "not installed";
    if (initSystem === "systemd") {
      const status = await execOnVps("systemctl is-active caddy 2>/dev/null || echo 'inactive'");
      caddyActive = status.stdout.trim() === "active";
    } else if (initSystem === "openrc") {
      const status = await execOnVps("rc-service caddy status 2>/dev/null || echo 'stopped'");
      caddyActive = status.stdout.trim().toLowerCase().includes("started");
    }
    // Also check if caddy process is running
    if (!caddyActive) {
      const proc = await execOnVps("ps | grep -v grep | grep caddy 2>/dev/null || echo ''");
      caddyActive = !!proc.stdout.trim();
    }
    // Also check docker container
    if (!caddyActive) {
      const docker = await execOnVps("docker ps --format '{{.Names}}' | grep -E '^caddy$' || echo ''");
      caddyActive = !!docker.stdout.trim();
    }

    const versionRes = await execOnVps(`${caddyBin} version 2>/dev/null || echo 'not installed'`);
    caddyVersion = versionRes.stdout.trim();
    if (caddyVersion.includes("not installed") && caddyActive) {
      caddyVersion = "running (docker or embedded)";
    }

    // Nginx status
    let nginxActive = false;
    let nginxVersion = "not installed";
    if (initSystem === "systemd") {
      const status = await execOnVps("systemctl is-active nginx 2>/dev/null || echo 'inactive'");
      nginxActive = status.stdout.trim() === "active";
    } else if (initSystem === "openrc") {
      const status = await execOnVps("rc-service nginx status 2>/dev/null || echo 'stopped'");
      nginxActive = status.stdout.trim().toLowerCase().includes("started");
    }
    if (!nginxActive) {
      const proc = await execOnVps("ps | grep -v grep | grep nginx 2>/dev/null || echo ''");
      nginxActive = !!proc.stdout.trim();
    }
    const nginxVerRes = await execOnVps(`${nginxBin} -v 2>&1 || echo 'not installed'`);
    nginxVersion = nginxVerRes.stdout.trim();

    // Caddy configs — scan all files, not just .caddy
    const caddyConfigs = await execOnVps(
      `for f in ${config.caddySitesDir}/*; do [ -f "$f" ] && echo "---FILE:$f---" && cat "$f"; done 2>/dev/null || echo ""`
    );

    // Nginx configs
    const nginxConfigs = await execOnVps(
      `for f in ${config.nginxSitesDir}/*; do [ -f "$f" ] && echo "---FILE:$f---" && cat "$f"; done 2>/dev/null || echo ""`
    );

    // Parse configs
    const caddySites = parseProxyConfigs(caddyConfigs.stdout);
    const nginxSites = parseProxyConfigs(nginxConfigs.stdout);

    return NextResponse.json({
      caddy: {
        active: caddyActive,
        version: caddyVersion,
        sites: caddySites,
      },
      nginx: {
        active: nginxActive,
        version: nginxVersion,
        sites: nginxSites,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { action, server } = await req.json();
    const config = await getSystemConfig();

    const caddyBin = await resolveBinary("caddy");
    const nginxBin = await resolveBinary("nginx");

    let result;
    switch (action) {
      case "reload":
        result = await execOnVps(
          server === "nginx"
            ? `${nginxBin} -t && systemctl reload nginx`
            : `${caddyBin} reload --config ${config.caddyFile} 2>/dev/null || systemctl reload caddy`
        );
        break;
      case "test":
        result = await execOnVps(
          server === "nginx" ? `${nginxBin} -t` : `${caddyBin} validate --config ${config.caddyFile} 2>/dev/null || echo 'caddy validate not available'`
        );
        break;
      case "logs":
        result = await execOnVps(
          server === "nginx"
            ? `tail -n 100 ${config.nginxLogPath} 2>/dev/null || journalctl -u nginx --no-pager -n 100`
            : "journalctl -u caddy --no-pager -n 100 2>/dev/null || docker logs --tail 100 caddy 2>/dev/null || echo 'No caddy logs found'"
        );
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    return NextResponse.json({
      success: result.code === 0,
      output: result.stdout,
      error: result.stderr,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function parseProxyConfigs(stdout: string) {
  const sites: { file: string; content: string }[] = [];
  const blocks = stdout.split("---FILE:");
  for (const block of blocks) {
    if (!block.trim()) continue;
    const idx = block.indexOf("\n");
    const file = block.slice(0, idx).replace(/---$/, "");
    const content = block.slice(idx + 1);
    sites.push({ file, content });
  }
  return sites;
}
