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
  stats?: any;
  composeProject?: string;
  composeService?: string;
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

export function matchContainersToSite<T extends { name: string; image: string }>(
  domain: string,
  proxy: string | null,
  containers: T[]
): T[] {
  const slugs = getSiteSlugs(domain);
  const proxyBase = proxy?.replace(/:.*/, "").toLowerCase() || "";

  return containers.filter((c) => {
    const cName = c.name.toLowerCase();
    if (proxyBase && cName.includes(proxyBase)) return true;
    for (const slug of slugs) {
      if (cName.includes(slug)) return true;
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

    // Strategy 2: Project-based matching (domain -> project -> containers)
    const project = findProjectForSite(site, dbProjects);
    if (project) {
      const projSlug = project.slug.toLowerCase();
      containers.forEach((c) => {
        if (matchedNames.has(c.name)) return;
        const composeProj = (c.composeProject || "").toLowerCase();
        const cName = c.name.toLowerCase();

        // Match by compose project name
        if (
          composeProj &&
          (composeProj === projSlug || composeProj.includes(projSlug) || projSlug.includes(composeProj))
        ) {
          matched.push(c);
          matchedNames.add(c.name);
          return;
        }

        // Match by container name: myproject-web-1, myproject_db_1, etc.
        if (
          projSlug.length > 2 &&
          (cName === projSlug ||
            cName.startsWith(projSlug + "-") ||
            cName.startsWith(projSlug + "_") ||
            cName.includes("-" + projSlug + "-") ||
            cName.includes("_" + projSlug + "_"))
        ) {
          matched.push(c);
          matchedNames.add(c.name);
          return;
        }
      });
    }

    // Strategy 3: Docker Compose project label matching (domain slug)
    const domainSlugs = getSiteSlugs(site.domain);
    containers.forEach((c) => {
      if (matchedNames.has(c.name)) return;
      const proj = (c.composeProject || "").toLowerCase();
      for (const slug of domainSlugs) {
        if (proj === slug || proj.includes(slug) || slug.includes(proj)) {
          matched.push(c);
          matchedNames.add(c.name);
          return;
        }
      }
    });

    // Strategy 4: Heuristic matching (proxy target + domain slug)
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
