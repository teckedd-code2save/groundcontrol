/**
 * Minimal reverse-proxy config parsers for graph rebuild after recovery.
 * Not full Caddy/Nginx validators — enough to re-derive domain→upstream routes.
 */

export interface ParsedProxyRoute {
  domain: string;
  path?: string;
  upstream: string;
  listenPort?: number;
}

/**
 * Parse a simple Caddyfile site block list into routes.
 * Supports:
 *   example.com {
 *     reverse_proxy host:port
 *   }
 */
export function parseCaddyfileRoutes(content: string): ParsedProxyRoute[] {
  const routes: ParsedProxyRoute[] = [];
  const blocks =
    content.matchAll(
      /^([^\s{#][^\n{]*)\s*\{([^}]*)\}/gm
    );

  for (const m of blocks) {
    const domain = m[1].trim().split(/\s+/)[0];
    const body = m[2] || "";
    const rp = body.match(/reverse_proxy\s+(\S+)/);
    if (!domain || !rp) continue;
    routes.push({
      domain,
      path: "/",
      upstream: rp[1],
      listenPort: 443,
    });
  }

  // One-liner without braces: "example.com reverse_proxy host:port"
  if (routes.length === 0) {
    const line = content.match(/^(\S+)\s+reverse_proxy\s+(\S+)/m);
    if (line) {
      routes.push({
        domain: line[1],
        path: "/",
        upstream: line[2],
        listenPort: 443,
      });
    }
  }

  return routes;
}

export function parseNginxRoutes(content: string): ParsedProxyRoute[] {
  const routes: ParsedProxyRoute[] = [];
  const servers = content.split(/server\s*\{/);
  for (const block of servers.slice(1)) {
    const serverName = block.match(/server_name\s+([^;]+);/)?.[1]?.trim().split(/\s+/)[0];
    const upstream =
      block.match(/proxy_pass\s+https?:\/\/([^;\s]+)/)?.[1] ||
      block.match(/proxy_pass\s+([^;\s]+)/)?.[1];
    if (serverName && upstream) {
      routes.push({
        domain: serverName,
        path: "/",
        upstream: upstream.replace(/\/$/, ""),
        listenPort: 443,
      });
    }
  }
  return routes;
}

export function parseProxyRoutes(
  content: string,
  proxyType: "caddy" | "nginx" | "unknown"
): ParsedProxyRoute[] {
  if (proxyType === "nginx") return parseNginxRoutes(content);
  return parseCaddyfileRoutes(content);
}
