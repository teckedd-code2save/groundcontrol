export interface RouteSite {
  file: string;
  domain: string;
  root: string | null;
  proxy: string | null;
  content?: string;
}

export interface RouteService {
  name: string;
  ports?: string[];
}

export interface RouteProject {
  slug: string;
  dirName: string;
  path: string;
  domain?: string;
  services: RouteService[];
}

export interface RouteContainer {
  name: string;
  ports?: string;
  composeService?: string;
}

export function normalizeRouteToken(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function tokensMatch(a: string, b: string): boolean {
  const left = normalizeRouteToken(a);
  const right = normalizeRouteToken(b);
  return !!left && !!right && left === right;
}

export function pathInside(workingDir: string, projectPath: string): boolean {
  const wd = (workingDir || "").toLowerCase().replace(/\/$/, "");
  const pp = (projectPath || "").toLowerCase().replace(/\/$/, "");
  if (!wd || !pp) return false;
  return wd === pp || wd.startsWith(pp + "/");
}

export function servicePortCandidates(service: RouteService): string[] {
  return (service.ports || []).flatMap((port) => {
    const text = String(port);
    const parts = text.split(":").map((part) => part.replace(/\/.*/, ""));
    return parts.filter((part) => /^\d+$/.test(part));
  });
}

export function containerPortCandidates(container: RouteContainer): string[] {
  return Array.from(String(container.ports || "").matchAll(/(?:0\.0\.0\.0|127\.0\.0\.1|\[::\])?:(\d+)->/g)).map((match) => match[1]);
}

export function findProjectSite(
  project: RouteProject,
  sites: RouteSite[] = [],
  containers: RouteContainer[] = []
): RouteSite | undefined {
  const exact = project.domain
    ? sites.find((site) => site.domain.toLowerCase() === project.domain!.toLowerCase())
    : undefined;
  if (exact) return exact;

  const projectTokens = [
    normalizeRouteToken(project.slug),
    normalizeRouteToken(project.dirName),
    compactToken(project.slug),
    compactToken(project.dirName),
    semanticToken(project.slug),
    semanticToken(project.dirName),
  ].filter((token) => token.length >= 4);
  const serviceTokens = [
    ...project.services.map((service) => normalizeRouteToken(service.name)),
    ...containers.map((container) => normalizeRouteToken(container.name)),
    ...containers.map((container) => normalizeRouteToken(container.composeService || "")),
  ].filter((token) => token.length >= 4);
  const ports = new Set([
    ...project.services.flatMap(servicePortCandidates),
    ...containers.flatMap(containerPortCandidates),
  ]);

  const scored = sites
    .map((site) => {
      let score = 0;
      const fileToken = stripCaddyPrefix(siteFileName(site));
      const domainToken = normalizeRouteToken(site.domain.replace(/^https?:\/\//, ""));
      const compactDomain = compactToken(site.domain);
      const proxyText = normalizeRouteToken(site.proxy || "");
      const sitePort = proxyPort(site.proxy);

      if (site.root && pathInside(site.root, project.path)) score += 100;
      if (sitePort && ports.has(sitePort)) score += 90;
      if (site.proxy || site.root) score += 15;
      if (projectTokens.some((token) => fileToken === token || fileToken.includes(token) || semanticToken(fileToken) === token)) score += 80;
      if (projectTokens.some((token) => domainToken === token || compactDomain.includes(token) || semanticToken(domainToken) === token)) score += 70;
      if (serviceTokens.some((token) => proxyText === token || proxyText.includes(token))) score += 50;

      return { site, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.site;
}

export function matchedServiceForSite(site: RouteSite, project: RouteProject, containers: RouteContainer[] = []): string {
  const port = proxyPort(site.proxy);
  const byPort = project.services.find((service) => servicePortCandidates(service).includes(port));
  if (byPort) return byPort.name;
  const proxyText = normalizeRouteToken(site.proxy || "");
  const byService = project.services.find((service) => proxyText.includes(normalizeRouteToken(service.name)));
  if (byService) return byService.name;
  const byContainer = containers.find((container) => proxyText.includes(normalizeRouteToken(container.name)));
  return byContainer?.composeService || byContainer?.name || "Deployment route";
}

function compactToken(value: string): string {
  return normalizeRouteToken(value).replace(/-/g, "");
}

function semanticToken(value: string): string {
  return normalizeRouteToken(value)
    .split("-")
    .filter((part) => part && !["a", "my", "the", "www", "http", "https"].includes(part))
    .join("");
}

function proxyPort(proxy: string | null): string {
  const match = String(proxy || "").match(/:(\d+)/);
  return match?.[1] || "";
}

function siteFileName(site: RouteSite): string {
  return (site.file || "").split("/").pop() || "";
}

function stripCaddyPrefix(value: string): string {
  return normalizeRouteToken(value.replace(/\.(caddy|conf)$/i, "").replace(/^\d+-/, "").replace(/^gc-/, ""));
}
