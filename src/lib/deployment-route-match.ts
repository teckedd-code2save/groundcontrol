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

export interface RouteMatchEvidence {
  rootPath: boolean;
  proxyPort: boolean;
  fileToken: boolean;
  domainToken: boolean;
  proxyService: boolean;
  liveContainerPort: boolean;
}

export interface RouteSiteMatch {
  site: RouteSite;
  score: number;
  confidence: "high" | "medium" | "low";
  evidence: RouteMatchEvidence;
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
  return findProjectSiteMatch(project, sites, containers)?.site;
}

export function findProjectSiteMatch(
  project: RouteProject,
  sites: RouteSite[] = [],
  containers: RouteContainer[] = []
): RouteSiteMatch | undefined {
  const exact = project.domain
    ? sites.find((site) => site.domain.toLowerCase() === project.domain!.toLowerCase())
    : undefined;
  if (exact) {
    return {
      site: exact,
      score: 200,
      confidence: "high",
      evidence: { rootPath: false, proxyPort: false, fileToken: false, domainToken: true, proxyService: false, liveContainerPort: false },
    };
  }

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
  const livePorts = new Set(containers.flatMap(containerPortCandidates));

  const scored = sites
    .map((site) => {
      let score = 0;
      const evidence: RouteMatchEvidence = {
        rootPath: false,
        proxyPort: false,
        fileToken: false,
        domainToken: false,
        proxyService: false,
        liveContainerPort: false,
      };
      const fileToken = stripCaddyPrefix(siteFileName(site));
      const domainToken = normalizeRouteToken(site.domain.replace(/^https?:\/\//, ""));
      const compactDomain = compactToken(site.domain);
      const proxyText = normalizeRouteToken(site.proxy || "");
      const sitePort = proxyPort(site.proxy);
      const hasRouteConfig = Boolean(site.proxy || site.root);

      if (site.root && pathInside(site.root, project.path)) {
        evidence.rootPath = true;
        score += 100;
      }
      if (sitePort && ports.has(sitePort)) {
        evidence.proxyPort = true;
        evidence.liveContainerPort = livePorts.has(sitePort);
        score += 45;
      }
      const identityTokens = [...projectTokens, ...serviceTokens];
      if (identityTokens.some((token) => tokensRelated(fileToken, token))) {
        evidence.fileToken = true;
        score += 80;
      }
      if (identityTokens.some((token) => tokensRelated(domainToken, token) || tokensRelated(compactDomain, token))) {
        evidence.domainToken = true;
        score += 70;
      }
      if (serviceTokens.some((token) => proxyText === token || proxyText.includes(token))) {
        evidence.proxyService = true;
        score += 50;
      }
      if (score > 0 && hasRouteConfig) score += 15;

      const strongEvidence = evidence.rootPath || evidence.fileToken || evidence.domainToken || evidence.proxyService;
      const confidence: RouteSiteMatch["confidence"] = evidence.rootPath || evidence.fileToken || evidence.domainToken
        ? "high"
        : strongEvidence && evidence.proxyPort
        ? "medium"
        : "low";

      return { site, score, confidence, evidence };
    })
    .filter((entry) => entry.score > 0)
    .filter((entry) => entry.confidence !== "low")
    .sort((a, b) => b.score - a.score);

  return scored[0];
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

function relaxedRouteToken(value: string): string {
  return semanticToken(value).replace(/my/g, "").replace(/a/g, "");
}

function tokensRelated(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right ||
    left.includes(right) ||
    right.includes(left) ||
    semanticToken(left) === right ||
    relaxedRouteToken(left) === relaxedRouteToken(right);
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
