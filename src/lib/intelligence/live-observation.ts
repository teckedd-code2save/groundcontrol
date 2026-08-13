import { scanProjectsTree } from "@/lib/project-scan";
import {
  getActiveVps,
  getSystemConfig,
  shQuote,
  type VpsConnection,
} from "@/lib/vps";
import { execOnTargetStrict } from "@/lib/host-exec";
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

async function readHostContainers(vps: VpsConnection) {
  const result = await execOnTargetStrict(
    `docker ps -a --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.State}}"`,
    vps
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Docker runtime evidence could not be read from the deployment host.");
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, image, status, ports, state] = line.split("|");
    return { name, image, status, ports, state };
  });
}

async function readHostComposeLabels(vps: VpsConnection, names: string[]) {
  const rows = await Promise.all(names.map(async (name) => {
    const result = await execOnTargetStrict(
      `docker inspect --format "{{.Name}}\t{{index .Config.Labels \\"com.docker.compose.project\\"}}\t{{index .Config.Labels \\"com.docker.compose.service\\"}}" ${shQuote(name)} 2>/dev/null`,
      vps
    );
    if (result.code !== 0 || !result.stdout.trim()) return null;
    const [containerName, project, service] = result.stdout.trim().split("\t");
    const clean = (value?: string) => value?.trim() === "<no value>" ? "" : value?.trim() || "";
    return {
      name: containerName.replace(/^\//, ""),
      project: clean(project),
      service: clean(service),
    };
  }));
  return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function parseListeners(value: string) {
  const listeners: Array<{ address: string; port: number }> = [];
  const seen = new Set<string>();
  for (const raw of value.split("\n").map((line) => line.trim()).filter(Boolean)) {
    const match = raw.match(/^(.*):(\d+)$/);
    const port = match?.[2] ? Number(match[2]) : 0;
    if (!match || port < 1 || port > 65535) continue;
    const address = match[1].replace(/^\[|\]$/g, "") || "0.0.0.0";
    const key = `${address}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listeners.push({ address, port });
  }
  return listeners;
}

function extractRuntimePortHints(value: string) {
  const seen = new Set<number>();
  const patterns = [
    /\bport["']?\s*[:=]\s*["']?(\d{2,5})\b/gi,
    /\blisten(?:ing)?(?:\s+on)?(?:\s+port)?\s+(\d{2,5})\b/gi,
    /\bserver\b.*\b:(\d{2,5})\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const port = Number(match[1]);
      if (port > 0 && port <= 65535) seen.add(port);
    }
  }
  return Array.from(seen).slice(0, 4);
}

async function readRuntimePortHints(vps: VpsConnection, containers: Array<{ name: string; status: string; state: string }>) {
  const candidates = containers
    .filter((container) => /unhealthy|restarting|exited|dead/i.test(`${container.status} ${container.state}`))
    .slice(0, 12);
  const rows = await Promise.all(candidates.map(async (container) => {
    const result = await execOnTargetStrict(
      `docker logs --tail 80 ${shQuote(container.name)} 2>&1`,
      vps
    );
    return [container.name, result.code === 0 ? extractRuntimePortHints(result.stdout) : []] as const;
  }));
  return new Map(rows.filter(([, ports]) => ports.length > 0));
}

/** Read-only host adapter used by the Intelligence workspace. */
export async function buildLiveHostObservation(): Promise<HostObservation> {
  const vps = await getActiveVps();
  if (!vps) throw new Error("Connect and activate a host before collecting intelligence evidence.");

  const config = await getSystemConfig();
  const [containers, tree, caddy, nginx, listeningSockets] = await Promise.all([
    readHostContainers(vps),
    scanProjectsTree(vps),
    execOnTargetStrict(
      `cat ${shQuote(config.caddyFile)} 2>/dev/null; printf '\\n'; for f in ${shQuote(config.caddySitesDir)}/*; do [ -f "$f" ] && { cat "$f"; printf '\\n'; }; done 2>/dev/null || true`,
      vps
    ),
    execOnTargetStrict(
      `for f in ${shQuote(config.nginxSitesDir)}/*; do [ -f "$f" ] && { cat "$f"; printf '\\n'; }; done 2>/dev/null || true`,
      vps
    ),
    execOnTargetStrict(
      `if command -v ss >/dev/null 2>&1; then ss -lntH 2>/dev/null | awk '{print $4}'; elif command -v netstat >/dev/null 2>&1; then netstat -lnt 2>/dev/null | awk 'NR > 2 {print $4}'; fi`,
      vps
    ),
  ]);
  const labels = await readHostComposeLabels(vps, containers.map((container) => container.name));
  const runtimePortHints = await readRuntimePortHints(vps, containers);

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
      runtimePortHints: runtimePortHints.get(container.name),
    };
  });

  const caddyContent = caddy.stdout.trim();
  const nginxContent = nginx.stdout.trim();
  const proxyType = caddyContent ? "caddy" : nginxContent ? "nginx" : "unknown";
  const proxyContent = caddyContent || nginxContent;
  const routes = proxyContent ? parseProxyRoutes(proxyContent, proxyType) : [];
  const proxyCandidate = observedContainers.find((container) => {
    const identity = `${container.name} ${container.image}`.toLowerCase();
    const matchesProxy = proxyType !== "unknown" && identity.includes(proxyType);
    const ownsEdgePort = container.ports.some((port) => port.host === 80 || port.host === 443);
    return matchesProxy && ownsEdgePort;
  });
  const proxyNetwork = proxyCandidate
    ? await execOnTargetStrict(
        `docker inspect --format "{{.HostConfig.NetworkMode}}" ${shQuote(proxyCandidate.name)} 2>/dev/null`,
        vps
      )
    : undefined;

  return {
    hostId: `${vps.host}:${vps.port}`,
    observedAt: new Date().toISOString(),
    source: "live",
    containers: observedContainers,
    composeProjects: tree.projects.map((project) => ({
      name: project.slug,
      path: project.path,
      services: project.services.map((service) => service.name),
      serviceDetails: project.services.map((service) => ({
        name: service.name,
        dependsOn: service.dependsOn,
        ports: service.ports,
      })),
    })),
    proxy: proxyContent
      ? {
          type: proxyType,
          configContent: proxyContent,
          fingerprint: fingerprintContent(proxyContent),
          execution: proxyCandidate
            ? {
                plane: "container",
                containerName: proxyCandidate.name,
                networkMode: proxyNetwork?.stdout.trim() || "unknown",
              }
            : { plane: "host" },
          routes,
        }
      : undefined,
    listeners: parseListeners(listeningSockets.stdout),
    domains: routes.map((route) => ({ domain: route.domain })),
  };
}
