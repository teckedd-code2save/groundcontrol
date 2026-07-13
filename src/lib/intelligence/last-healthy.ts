import type { LastKnownHealthy, ProbeResult, ServicePath } from "./types";

/**
 * Capture a last-known-healthy snapshot when path is healthy and probes pass.
 * Returns null if the path is not healthy.
 */
export function captureLastKnownHealthy(args: {
  hostId: string;
  path: ServicePath;
  probes: ProbeResult[];
  proxyRevisionId?: string;
  artifactRef?: string;
  capturedAt: string;
  extra?: Record<string, unknown>;
}): LastKnownHealthy | null {
  if (!args.path.healthy) return null;
  const serviceId = args.path.serviceId || args.path.domain;
  const relevantProbes = args.probes.filter(
    (p) => !p.serviceId || p.serviceId === serviceId || p.target.includes(args.path.domain)
  );
  const failed = relevantProbes.filter((p) => !p.ok);
  if (failed.length > 0) return null;

  return {
    hostId: args.hostId,
    serviceId,
    capturedAt: args.capturedAt,
    graphPath: { ...args.path },
    probeResults: relevantProbes,
    proxyRevisionId: args.proxyRevisionId,
    artifactRef: args.artifactRef,
    snapshot: {
      domain: args.path.domain,
      upstream: args.path.upstream,
      containerName: args.path.containerName,
      containerPort: args.path.containerPort,
      containerState: args.path.containerState,
      ...(args.extra || {}),
    },
  };
}

/** In-memory last-healthy store (also serialized for API/fixtures). */
export class LastHealthyStore {
  private byService = new Map<string, LastKnownHealthy>();

  key(hostId: string, serviceId: string): string {
    return `${hostId}::${serviceId}`;
  }

  put(snapshot: LastKnownHealthy): void {
    this.byService.set(this.key(snapshot.hostId, snapshot.serviceId), snapshot);
  }

  get(hostId: string, serviceId: string): LastKnownHealthy | undefined {
    return this.byService.get(this.key(hostId, serviceId));
  }

  getForDomain(hostId: string, domain: string): LastKnownHealthy | undefined {
    for (const snap of this.byService.values()) {
      if (snap.hostId === hostId && snap.graphPath.domain.toLowerCase() === domain.toLowerCase()) {
        return snap;
      }
    }
    return undefined;
  }

  all(): LastKnownHealthy[] {
    return Array.from(this.byService.values());
  }

  load(items: LastKnownHealthy[]): void {
    this.byService.clear();
    for (const item of items) this.put(item);
  }
}
