import { NextRequest, NextResponse } from "next/server";
import { execOnVps, resolveBinary, getSystemConfig } from "@/lib/vps";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const config = await getSystemConfig();

    const caddyBin = await resolveBinary("caddy");
    const nginxBin = await resolveBinary("nginx");

    // Caddy status
    const caddyStatus = await execOnVps("systemctl is-active caddy 2>/dev/null || echo 'inactive'");
    const caddyVersion = await execOnVps(`${caddyBin} version 2>/dev/null || echo 'not installed'`);

    // Nginx status
    const nginxStatus = await execOnVps("systemctl is-active nginx 2>/dev/null || echo 'inactive'");
    const nginxVersion = await execOnVps(`${nginxBin} -v 2>&1 || echo 'not installed'`);

    // Caddy configs
    const caddyConfigs = await execOnVps(
      `for f in ${config.caddySitesDir}/*.caddy; do [ -f "$f" ] && echo "---FILE:$f---" && cat "$f"; done`
    );

    // Nginx configs
    const nginxConfigs = await execOnVps(
      `for f in ${config.nginxSitesDir}/*; do [ -f "$f" ] && echo "---FILE:$f---" && cat "$f"; done`
    );

    // Parse configs
    const caddySites = parseProxyConfigs(caddyConfigs.stdout);
    const nginxSites = parseProxyConfigs(nginxConfigs.stdout);

    return NextResponse.json({
      caddy: {
        active: caddyStatus.stdout.trim() === "active",
        version: caddyVersion.stdout.trim(),
        sites: caddySites,
      },
      nginx: {
        active: nginxStatus.stdout.trim() === "active",
        version: nginxVersion.stdout.trim(),
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
