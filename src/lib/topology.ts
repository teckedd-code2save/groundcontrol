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
  stats?: unknown;
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
