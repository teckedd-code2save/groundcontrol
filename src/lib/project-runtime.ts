// src/lib/project-runtime.ts
//
// Unified data model that deterministically links projects → compose services
// → live Docker containers → Caddy/Nginx sites. Replaces the 4-separate-API-calls
// + heuristic-frontend-joins pattern with one clean object served from one endpoint.
//
// Container matching: Docker compose labels (com.docker.compose.project/service)
// are the primary, deterministic link. Falls back to container name prefix matching
// only when labels are absent.

import { scanProjectsTree, type ScannedProject, type ComposeServiceInfo } from "./project-scan";
import { getDockerContainers, getDockerStats, getDockerContainerLabels, type DockerContainerLabelInfo } from "./vps";

// ── Public types ────────────────────────────────────────

export interface LiveContainer {
  name: string;
  image: string;
  state: string;
  status: string;
  ports?: string;
  stats?: {
    cpu: string;
    mem: string;
    pids: string;
  };
}

export interface RuntimeService {
  name: string;
  image?: string;
  build?: boolean;
  ports?: string[];
  /** The live container for this service, or null if not running. */
  container: LiveContainer | null;
}

export interface ProjectSite {
  domain: string;
  proxy: string | null;
  root: string | null;
  file: string;
}

export interface RuntimeProject {
  slug: string;
  name: string;
  path: string;
  composePath: string;
  domain?: string;
  hasGit: boolean;
  parent: string | null;
  services: RuntimeService[];
  /** Containers in this compose project not matching a declared service name. */
  extraContainers: LiveContainer[];
  sites: ProjectSite[];
  health: "healthy" | "warning" | "critical";
  /** Number of compose-declared services (whether running or not). */
  serviceCount: number;
  /** Total containers in this project (services + extras). */
  containerCount: number;
}

export interface ProjectRuntime {
  projects: RuntimeProject[];
  unclaimedContainers: LiveContainer[];
  unclaimedSites: ProjectSite[];
  /** One-line summary for the AI agent system prompt. */
  summary: string;
  error?: string;
}

// ── Internal types ──────────────────────────────────────

interface DockerContainer {
  name: string;
  image: string;
  status: string;
  ports: string;
  id: string;
  state: string;
}

interface DockerStat {
  name: string;
  cpu: string;
  mem: string;
  pids: string;
}

// ── Builder ─────────────────────────────────────────────

export async function buildProjectRuntime(): Promise<ProjectRuntime> {
  const [scanResult, containers, labels, stats] = await Promise.all([
    scanProjectsTree().catch(() => ({ projects: [] as ScannedProject[], plainDirs: [] as string[], error: "scan failed" })),
    getDockerContainers().catch(() => [] as DockerContainer[]),
    getDockerContainerLabels().catch(() => [] as DockerContainerLabelInfo[]),
    getDockerStats().catch(() => [] as DockerStat[]),
  ]);

  const { projects: scanned } = scanResult;

  // Build label lookup: container name → label info
  const labelMap = new Map<string, DockerContainerLabelInfo>();
  for (const l of labels) {
    labelMap.set(l.name, l);
  }

  // Build stats lookup
  const statsMap = new Map<string, DockerStat>();
  for (const s of stats) {
    statsMap.set(s.name, s);
  }

  // Convert Docker containers to LiveContainer with stats
  function toLive(c: DockerContainer): LiveContainer {
    const st = statsMap.get(c.name);
    return {
      name: c.name,
      image: c.image,
      state: c.state,
      status: c.status,
      ports: c.ports,
      stats: st ? { cpu: st.cpu, mem: st.mem, pids: st.pids } : undefined,
    };
  }

  // Track which containers have been claimed by a project
  const claimedContainers = new Set<string>();
  const runtimeProjects: RuntimeProject[] = [];

  for (const proj of scanned) {
    const projSlug = proj.slug.toLowerCase();

    // Match containers to services via compose labels
    const services: RuntimeService[] = proj.services.map(svc => {
      const container = findMatchingContainer(svc, containers, labelMap, projSlug);
      if (container) claimedContainers.add(container.name);
      return {
        name: svc.name,
        image: svc.image,
        build: svc.build,
        ports: svc.ports,
        container: container ? toLive(container) : null,
      };
    });

    // Extra containers: in the same compose project but not matching a service name
    const extraContainers: LiveContainer[] = [];
    for (const c of containers) {
      if (claimedContainers.has(c.name)) continue;
      const info = labelMap.get(c.name);
      if (!info) continue;
      const projLabel = info.project.toLowerCase();
      if (projLabel === projSlug) {
        claimedContainers.add(c.name);
        extraContainers.push(toLive(c));
      }
    }

    const allLive = [
      ...services.map(s => s.container).filter((c): c is LiveContainer => c !== null),
      ...extraContainers,
    ];

    runtimeProjects.push({
      slug: proj.slug,
      name: proj.name,
      path: proj.path,
      composePath: proj.composePath,
      domain: proj.domain,
      hasGit: proj.hasGit,
      parent: proj.parent,
      services,
      extraContainers,
      sites: [], // filled in later by API route
      health: computeHealth(allLive),
      serviceCount: proj.services.length,
      containerCount: allLive.length,
    });
  }

  // Unclaimed containers: no compose label match
  const unclaimedContainers = containers
    .filter(c => !claimedContainers.has(c.name))
    .map(toLive);

  const summary = buildSummary(runtimeProjects, unclaimedContainers);

  return {
    projects: runtimeProjects,
    unclaimedContainers,
    unclaimedSites: [],
    summary,
    error: scanResult.error,
  };
}

// ── Container matching ──────────────────────────────────

function findMatchingContainer(
  svc: ComposeServiceInfo,
  containers: DockerContainer[],
  labelMap: Map<string, DockerContainerLabelInfo>,
  projSlug: string,
): DockerContainer | null {
  const svcName = svc.name.toLowerCase();

  for (const c of containers) {
    const info = labelMap.get(c.name);
    if (!info) continue;

    const composeProject = info.project.toLowerCase();
    const composeService = info.service.toLowerCase();

    // Deterministic: labels exist and match exactly
    if (composeProject && composeService) {
      if (composeProject === projSlug && composeService === svcName) {
        return c;
      }
    }
  }

  // Fallback: no labels → heuristic by container name pattern
  // docker-compose default: <project>_<service>_<n>
  // alternative: <project>-<service>-<hash>
  for (const c of containers) {
    const name = c.name.toLowerCase();
    if (
      name.startsWith(`${projSlug}_${svcName}_`) ||
      name.startsWith(`${projSlug}-${svcName}-`)
    ) {
      return c;
    }
  }

  return null;
}

// ── Health computation ──────────────────────────────────

function computeHealth(containers: LiveContainer[]): "healthy" | "warning" | "critical" {
  if (containers.length === 0) return "warning";
  if (containers.some(c => c.state !== "running")) return "warning";
  if (containers.some(c => c.status.toLowerCase().includes("unhealthy"))) return "critical";
  return "healthy";
}

// ── Summary for AI agent ────────────────────────────────

function buildSummary(projects: RuntimeProject[], unclaimed: LiveContainer[]): string {
  const parts: string[] = [];
  for (const p of projects) {
    const running = p.services.filter(s => s.container?.state === "running").length;
    const total = p.serviceCount + p.extraContainers.length;
    const domain = p.domain || p.sites[0]?.domain || "no domain";
    parts.push(`${p.name}: ${running}/${total} running, ${domain}`);
  }
  if (unclaimed.length > 0) {
    parts.push(`${unclaimed.length} unclaimed container(s): ${unclaimed.map(c => c.name).join(", ")}`);
  }
  return parts.join(" | ") || "No projects discovered";
}
