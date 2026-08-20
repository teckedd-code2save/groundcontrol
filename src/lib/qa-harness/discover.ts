import { probeHttp, originOfUrl } from "./probe";
import { scanSourceRoutes } from "./source-routes";
import type {
  DiscoverContractsInput,
  DiscoverContractsResult,
  DraftContract,
  HttpProbeResult,
} from "./types";

const GET_METHODS = new Set(["GET", "HEAD"]);

function stableName(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function confidenceFor(source: DraftContract["source"], probed: boolean): number {
  if (source === "source") return probed ? 0.9 : 0.6;
  if (source === "snapshot") return 0.8;
  return 0.5;
}

function assertableStatus(method: string, probe: HttpProbeResult | null): number | null {
  if (!probe || probe.statusCode == null) return null;
  if (!GET_METHODS.has(method)) return null;
  if (probe.statusCode < 500 || probe.statusCode === 401 || probe.statusCode === 403) {
    return probe.statusCode;
  }
  return null;
}

/**
 * Unified, deterministic contract-discovery entrypoint. It merges two
 * independent evidence sources into reviewable drafts:
 *   1. routes recovered from repository source, and
 *   2. live snapshots of seed/existing paths.
 * Nothing here mutates state; persistence and approval happen at the API layer.
 */
export async function discoverContracts(
  input: DiscoverContractsInput
): Promise<DiscoverContractsResult> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  const baseOrigin = originOfUrl(baseUrl);
  const warnings: string[] = [];
  const drafts: DraftContract[] = [];
  const seen = new Set<string>();
  const existing = new Set(
    (input.existingChecks || []).map((check) => stableName(check.method, check.path))
  );
  let probed = 0;

  const routes = scanSourceRoutes(input.sourceFiles || []);
  const seedPaths = Array.from(new Set(input.seedPaths || [])).filter(Boolean);

  const snapshotPaths = new Set<string>();
  for (const seed of seedPaths) snapshotPaths.add(seed.startsWith("/") ? seed : `/${seed}`);

  const coveredPaths = new Set(routes.map((route) => route.path));

  for (const route of routes) {
    const key = stableName(route.method, route.path);
    if (seen.has(key) || existing.has(key)) continue;
    seen.add(key);

    let probe: HttpProbeResult | null = null;
    const shouldProbe = input.probe !== false && GET_METHODS.has(route.method) && Boolean(baseOrigin);
    if (shouldProbe) {
      probe = await probeHttp({ url: `${baseUrl}${route.path}`, method: route.method, baseOrigin: baseOrigin || undefined });
      probed += 1;
    }

    drafts.push({
      component: input.component,
      name: stableName(route.method, route.path),
      method: route.method,
      path: route.path,
      headers: {},
      body: null,
      expectedStatus: assertableStatus(route.method, probe),
      expectedBodyContains: null,
      source: "source",
      status: "draft",
      evidenceRef: route.line ? `${route.filePath}:${route.line}` : route.filePath,
      revisionSha: input.revisionSha || null,
      confidence: confidenceFor("source", Boolean(probe)),
      probed: probe,
    });
  }

  for (const path of snapshotPaths) {
    if (coveredPaths.has(path)) continue;
    for (const method of ["GET"]) {
      const key = stableName(method, path);
      if (seen.has(key) || existing.has(key)) continue;
      seen.add(key);

      let probe: HttpProbeResult | null = null;
      if (input.probe !== false && baseOrigin) {
        probe = await probeHttp({ url: `${baseUrl}${path}`, method, baseOrigin });
        probed += 1;
      }
      drafts.push({
        component: input.component,
        name: stableName(method, path),
        method,
        path,
        headers: {},
        body: null,
        expectedStatus: assertableStatus(method, probe),
        expectedBodyContains: null,
        source: "snapshot",
        status: "draft",
        evidenceRef: null,
        revisionSha: input.revisionSha || null,
        confidence: confidenceFor("snapshot", Boolean(probe)),
        probed: probe,
      });
    }
  }

  if (!baseOrigin) {
    warnings.push("No probeable origin resolved; drafts were generated without live verification.");
  }
  if (input.sourceFiles && input.sourceFiles.length === 0) {
    warnings.push("No source files were provided, so only snapshot discovery ran.");
  }

  return { drafts, sourceRoutesFound: routes.length, probed, warnings };
}
