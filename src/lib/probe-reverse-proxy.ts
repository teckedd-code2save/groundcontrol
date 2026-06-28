// src/lib/probe-reverse-proxy.ts
//
// Discover the active reverse proxy on the target VPS.
// Checks process list (Caddy, Nginx, Traefik, HAProxy, Apache),
// listening ports (80, 443), and locates config paths.

import { execOnTarget } from "./host-exec";
import { shQuote } from "./vps";

export type ReverseProxyType = 
  | "caddy" 
  | "nginx" 
  | "traefik" 
  | "haproxy" 
  | "apache"
  | "unknown" 
  | "none";

export interface DiscoveredProxy {
  type: ReverseProxyType;
  configPaths: string[];
  listening: { port80: boolean; port443: boolean };
  /** Process name that matched. */
  processName?: string;
}

export async function probeReverseProxy(): Promise<DiscoveredProxy> {
  // Check what's listening on 80 and 443
  const ports = await execOnTarget(
    `ss -tlnp 2>/dev/null | grep -E ':(80|443) ' || ss -tln 2>/dev/null | grep -E ':(80|443) ' || echo ""`
  );
  const port80 = /:80\s/.test(ports.stdout) || /:80$/.test(ports.stdout);
  const port443 = /:443\s/.test(ports.stdout) || /:443$/.test(ports.stdout);

  // Check for each proxy by process name
  const checks = [
    { type: "caddy" as const, process: "caddy", paths: ["/etc/caddy/Caddyfile", "/etc/caddy/sites", "/etc/caddy/conf.d"] },
    { type: "nginx" as const, process: "nginx", paths: ["/etc/nginx/nginx.conf", "/etc/nginx/sites-available", "/etc/nginx/conf.d", "/etc/nginx/sites-enabled"] },
    { type: "traefik" as const, process: "traefik", paths: ["/etc/traefik/traefik.yml", "/etc/traefik/traefik.yaml", "/etc/traefik/dynamic", "/opt/traefik"] },
    { type: "haproxy" as const, process: "haproxy", paths: ["/etc/haproxy/haproxy.cfg"] },
    { type: "apache" as const, process: "apache2", paths: ["/etc/apache2/sites-available", "/etc/apache2/apache2.conf"] },
    { type: "apache" as const, process: "httpd", paths: ["/etc/httpd/conf/httpd.conf", "/etc/httpd/conf.d"] },
  ];

  for (const { type, process, paths } of checks) {
    const pgrep = await execOnTarget(`pgrep -x ${shQuote(process)} >/dev/null 2>&1 && echo yes || echo no`);
    if (pgrep.stdout.trim() === "yes") {
      const configPaths = await findExistingPaths(paths);
      return { type, configPaths, listening: { port80, port443 }, processName: process };
    }
  }

  // No known proxy process found, but something is listening
  if (port80 || port443) {
    return { type: "unknown", configPaths: [], listening: { port80, port443 } };
  }

  return { type: "none", configPaths: [], listening: { port80: false, port443: false } };
}

async function findExistingPaths(candidates: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of candidates) {
    const result = await execOnTarget(`test -e ${shQuote(path)} && echo ${shQuote(path)} || echo ""`);
    const trimmed = result.stdout.trim();
    if (trimmed) found.push(trimmed);
  }
  return found;
}
