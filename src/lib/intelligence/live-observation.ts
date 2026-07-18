import { scanProjectsTree } from "@/lib/project-scan";
import {
  execOnVps,
  getActiveVps,
  getDockerContainerLabels,
  getDockerContainers,
  getSystemConfig,
  shQuote,
} from "@/lib/vps";
import { fingerprintContent } from "./recovery";
import { parseProxyRoutes } from "./proxy-parse";
import type { HostObservation } from "./types";

function parsePublishedPorts(value: string) {
  const seen = new Set<string>();
  return Array.from(value.matchAll(/(?:(\d+)(?::|->))?(\d+)\/(tcp|udp)/g)).flatMap((match) => {
    const host = match[1] ? Number(match[1]) : undefined;
    const container = Number(match[2]);
    const key = `${host || ""}:${container}:${match[3]}`;
    if (!container || seen.has(key)) return [];
    seen.add(key);
    return [{ host, container, protocol: match[3] }];
  });
}

/** Read-only host adapter used by the Intelligence workspace. */
export async function buildLiveHostObservation(): Promise<HostObservation> {
  const vps = await getActiveVps();
  if (!vps) throw new Error("Connect and activate a host before collecting intelligence evidence.");

  const config = await getSystemConfig();
  const [containers, labels, tree, caddy, nginx] = await Promise.all([
    getDockerContainers(vps),
    getDockerContainerLabels(vps),
    scanProjectsTree(vps),
    execOnVps(
      `cat ${shQuote(config.caddyFile)} 2>/dev/null; printf '\\n'; for f in ${shQuote(config.caddySitesDir)}/*; do [ -f "$f" ] && { cat "$f"; printf '\\n'; }; done 2>/dev/null || true`,
      vps
    ),
    execOnVps(
      `for f in ${shQuote(config.nginxSitesDir)}/*; do [ -f "$f" ] && { cat "$f"; printf '\\n'; }; done 2>/dev/null || true`,
      vps
    ),
  ]);

  const labelsByName = new Map(labels.map((entry) => [entry.name, entry]));
  const observedContainers = containers.map((container) => {
    const label = labelsByName.get(container.name);
    return {
      name: container.name,
      image: container.image,
      state: container.state,
      status: container.status,
      composeProject: label?.project || undefined,
      composeService: label?.service || undefined,
      ports: parsePublishedPorts(container.ports || ""),
    };
  });

  const caddyContent = caddy.stdout.trim();
  const nginxContent = nginx.stdout.trim();
  const proxyType = caddyContent ? "caddy" : nginxContent ? "nginx" : "unknown";
  const proxyContent = caddyContent || nginxContent;
  const routes = proxyContent ? parseProxyRoutes(proxyContent, proxyType) : [];

  return {
    hostId: `${vps.host}:${vps.port}`,
    observedAt: new Date().toISOString(),
    source: "live",
    containers: observedContainers,
    composeProjects: tree.projects.map((project) => ({
      name: project.slug,
      path: project.path,
      services: project.services.map((service) => service.name),
    })),
    proxy: proxyContent
      ? {
          type: proxyType,
          configContent: proxyContent,
          fingerprint: fingerprintContent(proxyContent),
          routes,
        }
      : undefined,
    domains: routes.map((route) => ({ domain: route.domain })),
  };
}
