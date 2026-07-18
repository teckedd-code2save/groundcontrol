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
  for (const block of topLevelBlocks(content)) {
    const domains = parseSiteAddresses(block.header);
    if (domains.length === 0) continue;
    const proxies = Array.from(block.body.matchAll(/^\s*reverse_proxy\s+([^\n#]+)/gm));
    for (const proxy of proxies) {
      const tokens = proxy[1].trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      const matcher = tokens[0].startsWith("/") || tokens[0].startsWith("@") ? tokens.shift() : undefined;
      const upstream = tokens.find((token) => !token.startsWith("{"));
      if (!upstream) continue;
      for (const domain of domains) {
        routes.push({
          domain,
          path: matcher?.startsWith("/") ? matcher : "/",
          upstream,
          listenPort: 443,
        });
      }
    }
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

function topLevelBlocks(content: string): Array<{ header: string; body: string }> {
  const blocks: Array<{ header: string; body: string }> = [];
  let depth = 0;
  let header = "";
  let bodyStart = -1;
  let lineStart = 0;
  let inComment = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\n") {
      lineStart = index + 1;
      inComment = false;
      continue;
    }
    if (char === "#" && !inComment) {
      inComment = true;
      continue;
    }
    if (inComment) continue;
    if (char === "{") {
      if (depth === 0) {
        header = content.slice(lineStart, index).trim();
        bodyStart = index + 1;
      }
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && bodyStart >= 0) {
        blocks.push({ header, body: content.slice(bodyStart, index) });
        bodyStart = -1;
      }
    }
  }
  return blocks;
}

function parseSiteAddresses(header: string): string[] {
  if (!header || header.startsWith("(") || header.startsWith("{")) return [];
  return header
    .split(",")
    .map((address) => address.trim().split(/\s+/)[0])
    .map((address) => address.replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .filter((address) => Boolean(address) && !address.startsWith(":"));
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
