export interface Site {
  domain: string;
  root: string | null;
  proxy: string | null;
  content?: string;
  file?: string;
}

export interface Container {
  name: string;
  image: string;
  status: string;
  state: string;
  stats?: { cpu: string; mem: string; pids: string };
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
  composeConfigFiles?: string;
  projectSlug?: string;
}

export interface SiteMap {
  siteDomain: string;
  containerName: string;
}

export interface DbProject {
  slug: string;
  domain?: string | null;
  path?: string | null;
}

export interface SiteGroup {
  site: Site;
  containers: Container[];
}

export function getSiteSlugs(domain: string): string[] {
  const slugs = new Set<string>();
  const clean = domain.toLowerCase().trim();

  // Remove common TLDs
  const withoutTld = clean.replace(
    /\.(com|net|org|io|dev|app|co|uk|us|de|fr|nl|be|eu|tech|cloud|space|online|store|site|blog|info|biz|ai|gh|za|ng)$/i,
    ""
  );

  // Remove www
  const withoutWww = withoutTld.replace(/^www\./, "");

  slugs.add(withoutWww);
  slugs.add(withoutWww.replace(/-/g, ""));
  slugs.add(withoutWww.replace(/[^a-z0-9]/g, ""));

  // Add each dot-separated part (e.g., "api.example.com" -> "api", "example")
  withoutWww.split(".").forEach((part) => {
    if (part.length > 2) slugs.add(part);
  });

  return Array.from(slugs).filter((s) => s.length > 2);
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getProxyHost(proxy: string | null): string {
  if (!proxy) return "";
  const firstTarget = proxy.trim().split(/\s+/)[0] || "";
  return firstTarget
    .replace(/^https?:\/\//, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/:.*/, "")
    .toLowerCase();
}

function tokensMatch(a: string, b: string): boolean {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (!left || !right) return false;
  return left === right;
}

function containerBelongsToProject(container: Container, project: DbProject): boolean {
  const projSlug = project.slug.toLowerCase();
  const projPath = (project.path || "").toLowerCase().replace(/\/$/, "");
  const composeProj = (container.composeProject || "").toLowerCase();
  const projectSlug = (container.projectSlug || "").toLowerCase();
  const workingDir = (container.composeWorkingDir || "").toLowerCase().replace(/\/$/, "");
  const cName = container.name.toLowerCase();

  if (composeProj && tokensMatch(composeProj, projSlug)) return true;
  if (projectSlug && tokensMatch(projectSlug, projSlug)) return true;
  if (projPath && workingDir && (workingDir === projPath || workingDir.startsWith(projPath + "/"))) return true;

  const nameBase = cName.replace(/[-_]\d+$/, "");
  return (
    projSlug.length > 2 &&
    (cName === projSlug ||
      cName.startsWith(projSlug + "-") ||
      cName.startsWith(projSlug + "_") ||
      nameBase === projSlug ||
      nameBase.startsWith(projSlug + "-") ||
      nameBase.startsWith(projSlug + "_"))
  );
}

export function matchContainersToSite<T extends { name: string; image: string }>(
  domain: string,
  proxy: string | null,
  containers: T[]
): T[] {
  const slugs = getSiteSlugs(domain);
  const proxyBase = getProxyHost(proxy);

  return containers.filter((c) => {
    const cName = c.name.toLowerCase();
    if (proxyBase && tokensMatch(cName, proxyBase)) return true;
    for (const slug of slugs) {
      if (tokensMatch(cName, slug)) return true;
    }
    return false;
  });
}

function findProjectForSite(site: Site, dbProjects: DbProject[]): DbProject | undefined {
  const domain = site.domain.toLowerCase();
  return dbProjects.find((p) => {
    if (!p.domain) return false;
    const pd = p.domain.toLowerCase();
    return pd === domain || pd === "www." + domain || domain === "www." + pd;
  });
}

// ---------------------------------------------------------------------------
// Project-centric topology
// ---------------------------------------------------------------------------

export interface ScannedComposeService {
  name: string;
  image?: string;
  build?: boolean;
  ports?: string[];
}

export interface ScannedProjectLite {
  slug: string;
  dirName: string;
  name: string;
  path: string;
  composePath: string;
  parent: string | null;
  services: ScannedComposeService[];
  domain?: string;
  hasGit: boolean;
}

export interface ProjectServiceNode {
  /** Compose service name. */
  service: string;
  /** Declared image (or null when the service is built locally). */
  image: string | null;
  build: boolean;
  ports: string[];
  /** Live container matched to this service, if running/known. */
  container?: Container;
}

export interface ProjectTopologyNode {
  slug: string;
  name: string;
  path: string;
  parent: string | null;
  domain?: string;
  hasGit: boolean;
  services: ProjectServiceNode[];
  /** Containers that belong to the project but weren't matched to a service. */
  extraContainers: Container[];
  /** Caddy/Nginx sites whose proxy/domain map onto this project. */
  sites: Site[];
}

export interface ProjectTopology {
  projects: ProjectTopologyNode[];
  /** Containers not claimed by any scanned project. */
  unclaimedContainers: Container[];
}

function pathMatches(workingDir: string, projectPath: string): boolean {
  const wd = workingDir.toLowerCase().replace(/\/$/, "");
  const pp = projectPath.toLowerCase().replace(/\/$/, "");
  if (!wd || !pp) return false;
  return wd === pp || wd.startsWith(pp + "/");
}

/**
 * Decide whether a live container belongs to a scanned project. The strongest
 * signal is the compose `working_dir` label matching the project's path
 * (handles nested projects unambiguously); we then fall back to compose project
 * name / config-file path / name-prefix heuristics.
 */
function containerBelongsToScannedProject(
  container: Container,
  project: ScannedProjectLite
): boolean {
  const projPath = project.path;
  const projDir = project.dirName.toLowerCase();
  const slugTail = project.slug.split("/").pop()?.toLowerCase() || projDir;
  const workingDir = container.composeWorkingDir || "";
  const configFiles = container.composeConfigFiles || "";
  const composeProj = (container.composeProject || "").toLowerCase();
  const cName = container.name.toLowerCase();

  // 1. working_dir label == project path (most reliable, handles nesting).
  if (workingDir && pathMatches(workingDir, projPath)) return true;
  // 2. config_files label points inside the project path.
  if (configFiles && pathMatches(configFiles, projPath)) return true;
  // 3. compose project label equals the directory / slug tail.
  if (composeProj && (tokensMatch(composeProj, projDir) || tokensMatch(composeProj, slugTail))) {
    return true;
  }
  // 4. container name prefixed by the dir name (compose default naming).
  const nameBase = cName.replace(/[-_]\d+$/, "");
  if (
    projDir.length > 2 &&
    (cName === projDir ||
      cName.startsWith(projDir + "-") ||
      cName.startsWith(projDir + "_") ||
      nameBase.startsWith(projDir + "-") ||
      nameBase.startsWith(projDir + "_"))
  ) {
    return true;
  }
  return false;
}

function matchContainerToService(
  service: ScannedComposeService,
  projectContainers: Container[],
  taken: Set<string>
): Container | undefined {
  const svc = service.name.toLowerCase();
  // Prefer the compose service label.
  let found = projectContainers.find(
    (c) => !taken.has(c.name) && tokensMatch(c.composeService || "", svc)
  );
  if (found) return found;
  // Then name-based: <project>-<service> or contains the service token.
  found = projectContainers.find((c) => {
    if (taken.has(c.name)) return false;
    const n = c.name.toLowerCase();
    return tokensMatch(n, svc) || n.endsWith("-" + svc) || n.endsWith("_" + svc) || n.includes(svc);
  });
  if (found) return found;
  // Finally, by image.
  if (service.image) {
    const img = service.image.toLowerCase();
    found = projectContainers.find(
      (c) => !taken.has(c.name) && c.image.toLowerCase() === img
    );
  }
  return found;
}

function siteMatchesProject(site: Site, project: ScannedProjectLite): boolean {
  // Explicit domain declared in compose.
  if (project.domain && site.domain.toLowerCase() === project.domain.toLowerCase()) {
    return true;
  }
  // Proxy target name maps onto the project / a service / dir name.
  const proxyHost = getProxyHost(site.proxy);
  if (proxyHost) {
    if (tokensMatch(proxyHost, project.dirName)) return true;
    if (project.services.some((s) => tokensMatch(proxyHost, s.name))) return true;
  }
  // Domain slug maps onto the dir name.
  const slugs = getSiteSlugs(site.domain);
  return slugs.some((s) => tokensMatch(s, project.dirName));
}

/**
 * Build a project-centric topology: each scanned project becomes a node that
 * expands into its compose services (each linked to a live container/image),
 * plus any Caddy/Nginx sites that proxy to it. Containers that match no scanned
 * project are returned as `unclaimedContainers`.
 */
export function buildProjectTopology<T extends Container>(
  projects: ScannedProjectLite[],
  containers: T[],
  sites: Site[],
  siteMaps: SiteMap[] = []
): ProjectTopology {
  const claimed = new Set<string>();
  const projectNodes: ProjectTopologyNode[] = [];

  for (const project of projects) {
    const projectContainers = containers.filter((c) =>
      containerBelongsToScannedProject(c, project)
    );
    const taken = new Set<string>();

    const services: ProjectServiceNode[] = project.services.map((svc) => {
      const container = matchContainerToService(svc, projectContainers, taken);
      if (container) taken.add(container.name);
      return {
        service: svc.name,
        image: svc.image ?? null,
        build: !!svc.build,
        ports: svc.ports || [],
        container,
      };
    });

    const extraContainers = projectContainers.filter((c) => !taken.has(c.name));
    projectContainers.forEach((c) => claimed.add(c.name));

    // Link sites: manual maps first (by claimed container), then heuristic.
    const matchedSites: Site[] = [];
    const seenSiteDomains = new Set<string>();
    const containerNames = new Set(projectContainers.map((c) => c.name));
    for (const site of sites) {
      if (seenSiteDomains.has(site.domain)) continue;
      const manualHit = siteMaps.some(
        (m) =>
          m.siteDomain.toLowerCase() === site.domain.toLowerCase() &&
          containerNames.has(m.containerName)
      );
      if (manualHit || siteMatchesProject(site, project)) {
        matchedSites.push(site);
        seenSiteDomains.add(site.domain);
      }
    }

    projectNodes.push({
      slug: project.slug,
      name: project.name,
      path: project.path,
      parent: project.parent,
      domain: project.domain,
      hasGit: project.hasGit,
      services,
      extraContainers,
      sites: matchedSites,
    });
  }

  const unclaimedContainers = containers.filter((c) => !claimed.has(c.name));
  return { projects: projectNodes, unclaimedContainers };
}

export function linkSitesToContainers<T extends Container>(
  sites: Site[],
  containers: T[],
  siteMaps: SiteMap[],
  dbProjects: DbProject[]
): { siteGroups: { site: Site; containers: T[] }[]; unmapped: T[] } {
  const usedContainers = new Set<string>();
  const siteGroups: { site: Site; containers: T[] }[] = [];

  for (const site of sites) {
    const matched: T[] = [];
    const matchedNames = new Set<string>();

    // Strategy 1: Manual mappings from DB
    const manual = siteMaps
      .filter((m) => m.siteDomain.toLowerCase() === site.domain.toLowerCase())
      .map((m) => containers.find((c) => c.name === m.containerName))
      .filter(Boolean) as T[];
    manual.forEach((c) => {
      matched.push(c);
      matchedNames.add(c.name);
    });

    // Strategy 2: Explicit proxy target matching. Caddy/Nginx usually proxy to
    // the Docker service/container hostname, so this is more reliable than
    // domain substring matching.
    const proxyHost = getProxyHost(site.proxy);
    if (proxyHost) {
      containers.forEach((c) => {
        if (matchedNames.has(c.name)) return;
        if (
          tokensMatch(c.name, proxyHost) ||
          tokensMatch(c.composeService || "", proxyHost) ||
          tokensMatch(c.composeProject || "", proxyHost) ||
          tokensMatch(c.projectSlug || "", proxyHost)
        ) {
          matched.push(c);
          matchedNames.add(c.name);
        }
      });
    }

    // Strategy 3: Project-based matching (domain -> project -> containers)
    const project = findProjectForSite(site, dbProjects);
    if (project) {
      containers.forEach((c) => {
        if (matchedNames.has(c.name)) return;
        if (containerBelongsToProject(c, project)) {
          matched.push(c);
          matchedNames.add(c.name);
        }
      });
    }

    // Strategy 4: Docker Compose project label matching (domain slug)
    const domainSlugs = getSiteSlugs(site.domain);
    containers.forEach((c) => {
      if (matchedNames.has(c.name)) return;
      const proj = (c.composeProject || "").toLowerCase();
      for (const slug of domainSlugs) {
        if (tokensMatch(proj, slug) || tokensMatch(c.projectSlug || "", slug)) {
          matched.push(c);
          matchedNames.add(c.name);
          return;
        }
      }
    });

    // Strategy 5: Heuristic matching (proxy target + domain slug)
    const heuristic = matchContainersToSite(
      site.domain,
      site.proxy,
      containers.filter((c) => !matchedNames.has(c.name))
    );
    heuristic.forEach((c) => {
      matched.push(c);
      matchedNames.add(c.name);
    });

    matched.forEach((c) => usedContainers.add(c.name));
    siteGroups.push({ site, containers: matched });
  }

  const unmapped = containers.filter((c) => !usedContainers.has(c.name));
  return { siteGroups, unmapped };
}
