import type { ChangeSet, OperationalEvent, OperationalEventKind } from "./types";

const DEFAULT_DEBOUNCE_MS = 15_000;

/**
 * Debounce raw operational events into change sets.
 * Events within `debounceMs` for the same host (and overlapping services when present)
 * collapse into one change set so rapid rollouts do not spawn duplicate Loop runs.
 */
export function debounceEvents(
  events: OperationalEvent[],
  options?: { debounceMs?: number; now?: string }
): ChangeSet[] {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  if (events.length === 0) return [];

  const sorted = [...events].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime()
  );

  const sets: ChangeSet[] = [];
  let current: ChangeSet | null = null;

  for (const ev of sorted) {
    if (!current) {
      current = startSet(ev);
      continue;
    }

    const gap =
      new Date(ev.observedAt).getTime() - new Date(current.lastObservedAt).getTime();
    const sameHost = ev.hostId === current.hostId;
    const serviceOverlap =
      current.serviceIds.length === 0 ||
      ev.serviceIds.length === 0 ||
      ev.serviceIds.some((s) => current!.serviceIds.includes(s));

    if (sameHost && gap <= debounceMs && serviceOverlap) {
      current.eventIds.push(ev.id);
      current.lastObservedAt = ev.observedAt;
      current.serviceIds = unique([...current.serviceIds, ...ev.serviceIds]);
      current.kinds = uniqueKinds([...current.kinds, ev.kind]);
    } else {
      sets.push(finalize(current, debounceMs));
      current = startSet(ev);
    }
  }

  if (current) sets.push(finalize(current, debounceMs));

  // Optional: if now is past stabilization window, mark stabilizedAt
  if (options?.now) {
    const nowMs = new Date(options.now).getTime();
    for (const s of sets) {
      if (nowMs - new Date(s.lastObservedAt).getTime() >= debounceMs) {
        s.stabilizedAt = new Date(
          new Date(s.lastObservedAt).getTime() + debounceMs
        ).toISOString();
      }
    }
  }

  return sets;
}

function startSet(ev: OperationalEvent): ChangeSet {
  return {
    id: `cs_${ev.id}`,
    hostId: ev.hostId,
    serviceIds: [...ev.serviceIds],
    eventIds: [ev.id],
    kinds: [ev.kind],
    firstObservedAt: ev.observedAt,
    lastObservedAt: ev.observedAt,
  };
}

function finalize(set: ChangeSet, debounceMs: number): ChangeSet {
  return {
    ...set,
    stabilizedAt: new Date(
      new Date(set.lastObservedAt).getTime() + debounceMs
    ).toISOString(),
  };
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function uniqueKinds(items: OperationalEventKind[]): OperationalEventKind[] {
  return Array.from(new Set(items));
}

/** Compare two proxy/config fingerprints into a proxy_changed event if different. */
export function detectProxyChange(args: {
  hostId: string;
  serviceIds: string[];
  beforeFingerprint?: string;
  afterFingerprint: string;
  observedAt: string;
  evidenceId?: string;
}): OperationalEvent | null {
  if (args.beforeFingerprint && args.beforeFingerprint === args.afterFingerprint) {
    return null;
  }
  return {
    id: `ev_proxy_${args.afterFingerprint.slice(0, 12)}_${Date.parse(args.observedAt) || 0}`,
    hostId: args.hostId,
    serviceIds: args.serviceIds,
    kind: "proxy_changed",
    observedAt: args.observedAt,
    source: "probe",
    beforeRef: args.beforeFingerprint,
    afterRef: args.afterFingerprint,
    evidenceArtifactIds: args.evidenceId ? [args.evidenceId] : [],
  };
}

export function detectContainerChange(args: {
  hostId: string;
  serviceId: string;
  containerName: string;
  beforeState?: string;
  afterState: string;
  beforeImage?: string;
  afterImage?: string;
  observedAt: string;
}): OperationalEvent | null {
  if (
    args.beforeState === args.afterState &&
    args.beforeImage === args.afterImage
  ) {
    return null;
  }
  const kind =
    args.beforeImage && args.afterImage && args.beforeImage !== args.afterImage
      ? "container_replaced"
      : "container_replaced";
  return {
    id: `ev_ctr_${args.containerName}_${Date.parse(args.observedAt) || 0}`,
    hostId: args.hostId,
    serviceIds: [args.serviceId],
    kind,
    observedAt: args.observedAt,
    source: "probe",
    beforeRef: args.beforeImage || args.beforeState,
    afterRef: args.afterImage || args.afterState,
    evidenceArtifactIds: [],
    meta: {
      containerName: args.containerName,
      beforeState: args.beforeState,
      afterState: args.afterState,
    },
  };
}
