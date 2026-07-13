import type {
  ChangeSet,
  CustomerJourney,
  OperationalEvent,
  OperationalEventKind,
  ServiceGraph,
  ServicePath,
} from "./types";
import { listServicePaths } from "./service-graph";

const KIND_TO_TRIGGER: Record<OperationalEventKind, string[]> = {
  artifact_changed: ["artifact.changed", "service.changed"],
  container_replaced: ["container.changed", "service.changed"],
  compose_changed: ["compose.changed", "topology.changed"],
  proxy_changed: ["proxy.changed"],
  environment_schema_changed: ["environment.changed"],
  network_changed: ["network.changed"],
  certificate_changed: ["certificate.changed", "proxy.changed"],
  resource_threshold_crossed: ["capacity.changed"],
  external_probe_failed: ["probe.failed"],
  manual_action: ["manual.action"],
};

/**
 * Compute which service IDs are affected by a change set given graph context.
 */
export function computeAffectedServiceIds(
  changeSet: ChangeSet,
  events: OperationalEvent[],
  graph: ServiceGraph
): string[] {
  const fromEvents = new Set<string>();
  for (const ev of events) {
    if (!changeSet.eventIds.includes(ev.id)) continue;
    for (const s of ev.serviceIds) fromEvents.add(s);
  }

  // Expand via graph: if proxy changed, all domains/routes' services are affected
  if (changeSet.kinds.includes("proxy_changed") || changeSet.kinds.includes("certificate_changed")) {
    for (const path of listServicePaths(graph)) {
      if (path.serviceId) fromEvents.add(path.serviceId);
      if (path.containerName) fromEvents.add(path.containerName);
    }
  }

  // If service ids empty, use all service nodes
  if (fromEvents.size === 0) {
    for (const n of graph.nodes) {
      if (n.serviceId) fromEvents.add(n.serviceId);
    }
  }

  return Array.from(fromEvents);
}

/**
 * Select operator-confirmed journeys whose triggers or serviceIds intersect the blast radius.
 * Never selects unconfirmed journeys.
 */
export function selectJourneysForChange(args: {
  journeys: CustomerJourney[];
  changeSet: ChangeSet;
  affectedServiceIds: string[];
  events?: OperationalEvent[];
}): CustomerJourney[] {
  const triggerTokens = new Set<string>();
  for (const kind of args.changeSet.kinds) {
    for (const t of KIND_TO_TRIGGER[kind] || []) triggerTokens.add(t);
  }
  // Also allow kind name itself as trigger
  for (const kind of args.changeSet.kinds) triggerTokens.add(kind);

  const affected = new Set(args.affectedServiceIds.map((s) => s.toLowerCase()));

  return args.journeys.filter((j) => {
    if (!j.confirmed) return false;

    const serviceHit = j.serviceIds.some((s) => affected.has(s.toLowerCase()));
    const triggerHit = j.triggers.some((t) => {
      const tl = t.toLowerCase();
      for (const token of triggerTokens) {
        if (tl === token.toLowerCase() || tl.includes(token.toLowerCase()) || token.toLowerCase().includes(tl)) {
          return true;
        }
      }
      // service-specific triggers like "web.changed"
      for (const sid of affected) {
        if (tl === `${sid}.changed` || tl.startsWith(`${sid}.`)) return true;
      }
      return false;
    });

    return serviceHit || triggerHit;
  });
}

/**
 * Paths that are currently degraded — useful for investigation seed.
 */
export function degradedPaths(graph: ServiceGraph): ServicePath[] {
  return listServicePaths(graph).filter((p) => !p.healthy);
}
