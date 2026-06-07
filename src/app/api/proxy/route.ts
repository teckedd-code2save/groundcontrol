import { NextRequest, NextResponse } from "next/server";
import { execOnVps, resolveBinary, getSystemConfig, type BinaryResolution } from "@/lib/vps";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const config = await getSystemConfig();

    const caddyResolution = await resolveBinary("caddy");
    const nginxResolution = await resolveBinary("nginx");

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
    if (!caddyActive) {
      const proc = await execOnVps("ps | grep -v grep | grep caddy 2>/dev/null || echo ''");
      caddyActive = !!proc.stdout.trim();
    }
    if (!caddyActive) {
      const docker = await execOnVps("docker ps --format '{{.Names}}' | grep -E '^caddy$' || echo ''");
      caddyActive = !!docker.stdout.trim();
    }

    if (caddyResolution.type === "docker") {
      const versionRes = await execOnVps(`docker exec ${caddyResolution.container} caddy version 2>/dev/null || echo 'not installed'`);
      caddyVersion = versionRes.stdout.trim();
    } else if (caddyResolution.type === "path") {
      const versionRes = await execOnVps(`${caddyResolution.path} version 2>/dev/null || echo 'not installed'`);
      caddyVersion = versionRes.stdout.trim();
    }
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
    if (!nginxActive) {
      const docker = await execOnVps("docker ps --format '{{.Names}}' | grep -E '^nginx$' || echo ''");
      nginxActive = !!docker.stdout.trim();
    }

    if (nginxResolution.type === "docker") {
      const nginxVerRes = await execOnVps(`docker exec ${nginxResolution.container} nginx -v 2>&1 || echo 'not installed'`);
      nginxVersion = nginxVerRes.stdout.trim();
    } else if (nginxResolution.type === "path") {
      const nginxVerRes = await execOnVps(`${nginxResolution.path} -v 2>&1 || echo 'not installed'`);
      nginxVersion = nginxVerRes.stdout.trim();
    }
    if (nginxVersion.includes("not installed") && nginxActive) {
      nginxVersion = "running (docker or embedded)";
    }

    // Caddy configs — scan all files, not just .caddy
    const caddyConfigs = await execOnVps(
      `for f in "${config.caddySitesDir}"/*; do [ -f "$f" ] && echo "---FILE:$f---" && cat "$f"; done 2>/dev/null || echo ""`
    );

    // Nginx configs
    const nginxConfigs = await execOnVps(
      `for f in "${config.nginxSitesDir}"/*; do [ -f "$f" ] && echo "---FILE:$f---" && cat "$f"; done 2>/dev/null || echo ""`
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

    const caddyResolution = await resolveBinary("caddy");
    const nginxResolution = await resolveBinary("nginx");

    const hasSystemd = await execOnVps("which systemctl 2>/dev/null || echo ''");
    const hasOpenRC = await execOnVps("which rc-service 2>/dev/null || echo ''");
    const initSystem = hasSystemd.stdout.trim() ? "systemd" : hasOpenRC.stdout.trim() ? "openrc" : "none";

    let result;
    switch (action) {
      case "reload": {
        const cmd = buildReloadCommand(server === "nginx" ? nginxResolution : caddyResolution, initSystem, server, config);
        result = await execOnVps(cmd);
        break;
      }
      case "test": {
        const cmd = buildTestCommand(server === "nginx" ? nginxResolution : caddyResolution, server, config);
        result = await execOnVps(cmd);
        break;
      }
      case "logs": {
        const cmd = buildLogsCommand(server === "nginx" ? nginxResolution : caddyResolution, initSystem, server, config);
        result = await execOnVps(cmd);
        break;
      }
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

function buildReloadCommand(
  resolution: BinaryResolution,
  initSystem: string,
  server: "caddy" | "nginx",
  config: { caddyFile: string }
): string {
  if (server === "caddy") {
    if (resolution.type === "docker") {
      return `docker exec ${resolution.container} caddy reload --config /etc/caddy/Caddyfile`;
    }
    const bin = resolution.type === "path" ? resolution.path : "caddy";
    const reloadCmd = `${bin} reload --config ${config.caddyFile}`;
    if (initSystem === "systemd") return `${reloadCmd} 2>/dev/null || systemctl reload caddy`;
    if (initSystem === "openrc") return `${reloadCmd} 2>/dev/null || rc-service caddy reload`;
    return reloadCmd;
  }

  // nginx
  if (resolution.type === "docker") {
    return `docker exec ${resolution.container} nginx -t && docker exec ${resolution.container} nginx -s reload`;
  }
  const bin = resolution.type === "path" ? resolution.path : "nginx";
  const testCmd = `${bin} -t`;
  if (initSystem === "systemd") return `${testCmd} && systemctl reload nginx`;
  if (initSystem === "openrc") return `${testCmd} && rc-service nginx reload`;
  return `${testCmd} && ${bin} -s reload`;
}

function buildTestCommand(
  resolution: BinaryResolution,
  server: "caddy" | "nginx",
  config: { caddyFile: string }
): string {
  if (server === "caddy") {
    if (resolution.type === "docker") {
      return `docker exec ${resolution.container} caddy validate --config /etc/caddy/Caddyfile`;
    }
    const bin = resolution.type === "path" ? resolution.path : "caddy";
    return `${bin} validate --config ${config.caddyFile} 2>/dev/null || echo 'caddy validate not available'`;
  }

  // nginx
  if (resolution.type === "docker") {
    return `docker exec ${resolution.container} nginx -t`;
  }
  const bin = resolution.type === "path" ? resolution.path : "nginx";
  return `${bin} -t`;
}

function buildLogsCommand(
  resolution: BinaryResolution,
  initSystem: string,
  server: "caddy" | "nginx",
  config: { nginxLogPath: string }
): string {
  if (server === "caddy") {
    return `journalctl -u caddy --no-pager -n 100 2>/dev/null || docker logs --tail 100 caddy 2>/dev/null || echo 'No caddy logs found'`;
  }

  // nginx
  let chain = `tail -n 100 ${config.nginxLogPath} 2>/dev/null`;
  if (initSystem === "systemd") {
    chain += ` || journalctl -u nginx --no-pager -n 100`;
  }
  if (resolution.type === "docker") {
    chain += ` || docker logs --tail 100 ${resolution.container} 2>/dev/null`;
  }
  chain += ` || echo 'No nginx logs found'`;
  return chain;
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
