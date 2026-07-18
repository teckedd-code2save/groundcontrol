import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  createHttpJourney,
  createHttpProbeExecutor,
  detectContainerChange,
  detectProxyChange,
  getGraphSummary,
  getLoopEngine,
  ingestEvents,
  ingestObservation,
  registerJourney,
  runProbes,
  setLoopEngine,
  shouldUseLiveRecovery,
  type LoopEngineState,
  type OperationalEvent,
} from "@/lib/intelligence";
import { buildLiveHostObservation } from "@/lib/intelligence/live-observation";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

function readiness(state: LoopEngineState) {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY);
  const hasDaytona = Boolean(process.env.DAYTONA_API_KEY || process.env.DAYTONA_TOKEN);
  const hasGraph = state.graph.nodes.length > 0;
  const paths = getGraphSummary(state).paths;
  const linkedPathCount = paths.filter((path) => Boolean(path.containerName)).length;
  const hasPublicPath = linkedPathCount > 0;
  const hasJourneys = state.journeys.some((journey) => journey.confirmed);
  return [
    { id: "host", label: "Live host evidence", ready: hasGraph, detail: hasGraph ? `${state.graph.nodes.length} topology nodes observed` : "Connect a host and collect evidence" },
    {
      id: "path",
      label: "Runtime-linked public path",
      ready: hasPublicPath,
      detail: paths.length === 0
        ? "No Caddy or Nginx public route was observed"
        : `${linkedPathCount}/${paths.length} observed route(s) linked to runtime evidence`,
    },
    {
      id: "journey",
      label: "HTTP reachability checks",
      ready: hasJourneys,
      detail: hasJourneys
        ? `${state.journeys.filter((journey) => journey.confirmed).length} system-generated public check(s); configure a customer journey for feature-level proof`
        : "No public HTTP check can be executed",
    },
    { id: "gemini", label: "Gemini investigation", ready: hasGemini, detail: hasGemini ? "Structured Gemini investigation enabled" : "Falls back to deterministic investigation until a Google API key is configured" },
    { id: "daytona", label: "Daytona reproduction", ready: hasDaytona, detail: hasDaytona ? "Sanitized remote reproduction enabled" : "Only local sanitized reproduction is available" },
    { id: "recovery", label: "Approved recovery", ready: shouldUseLiveRecovery(), detail: shouldUseLiveRecovery() ? "Allowlisted live recovery adapter enabled" : "GC_LOOP_LIVE is off; GroundControl will not mutate the host" },
    { id: "browser", label: "Browser journey depth", ready: false, detail: "Current executor proves HTTP status only; browser interactions and authenticated flows are not yet implemented" },
    { id: "persistence", label: "Durable operational memory", ready: false, detail: "Loop state is process-local in this build and resets when the app process restarts" },
  ];
}

function publicState(state: LoopEngineState) {
  const summary = getGraphSummary(state);
  const paths = summary.paths.map((path) => {
    const probe = state.pathProbes.get(path.domain.toLowerCase());
    return {
      ...path,
      topologyStatus: path.containerName ? "linked" : "partial",
      verification: probe
        ? {
            status: probe.ok ? "passed" : probe.statusCode != null && probe.statusCode < 500 ? "responded" : "failed",
            statusCode: probe.statusCode,
            latencyMs: probe.latencyMs,
            error: probe.error,
            observedAt: probe.observedAt,
            target: probe.target,
          }
        : { status: "not_run" },
    };
  });
  return {
    ...summary,
    paths,
    maturity: state.graph.nodes.length > 0 ? "live" : "awaiting_observation",
    readiness: readiness(state),
    journeyCount: state.journeys.length,
    eventCount: state.events.length,
    changeSetCount: state.changeSets.length,
    note: state.graph.nodes.length === 0 ? "No live service graph has been reconciled from the host yet." : undefined,
  };
}

/** GET the current read-only service graph. */
export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return NextResponse.json(publicState(getLoopEngine()));
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST performs a read-only host reconciliation and records meaningful changes. */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const current = getLoopEngine();
    const observation = await buildLiveHostObservation();
    const previous = current.lastObservation;
    const events: OperationalEvent[] = [];

    if (!previous) {
      events.push({
        id: `ev_observation_${Date.parse(observation.observedAt)}`,
        hostId: observation.hostId,
        serviceIds: observation.containers.map((container) => container.composeService || container.name),
        kind: "manual_action",
        observedAt: observation.observedAt,
        source: "groundcontrol",
        evidenceArtifactIds: [],
        meta: { action: "initial_live_reconciliation", containerCount: observation.containers.length },
      });
    } else {
      if (observation.proxy) {
        const proxyEvent = detectProxyChange({
          hostId: observation.hostId,
          serviceIds: observation.containers.map((container) => container.composeService || container.name),
          beforeFingerprint: previous.proxy?.fingerprint,
          afterFingerprint: observation.proxy.fingerprint,
          observedAt: observation.observedAt,
        });
        if (proxyEvent) events.push(proxyEvent);
      }
      for (const container of observation.containers) {
        const before = previous.containers.find((candidate) => candidate.name === container.name);
        const event = detectContainerChange({
          hostId: observation.hostId,
          serviceId: container.composeService || container.name,
          containerName: container.name,
          beforeState: before?.state,
          afterState: container.state,
          beforeImage: before?.image,
          afterImage: container.image,
          observedAt: observation.observedAt,
        });
        if (event && before) events.push(event);
      }
    }

    let next = ingestObservation(current, observation);
    if (events.length > 0) next = ingestEvents(next, events);
    for (const route of observation.proxy?.routes || []) {
      const path = getGraphSummary(next).paths.find((candidate) => candidate.domain === route.domain);
      const id = `journey_${route.domain.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
      next = registerJourney(next, createHttpJourney({
        id,
        name: `${route.domain} responds publicly`,
        serviceIds: path?.serviceId ? [path.serviceId] : [],
        publicUrl: `https://${route.domain}/`,
        expectStatus: 200,
        confirmed: true,
      }));
    }

    const pathProbes = new Map(next.pathProbes);
    const probeExecutor = createHttpProbeExecutor(8_000);
    await Promise.all(getGraphSummary(next).paths.map(async (path) => {
      const target = `https://${path.domain}/`;
      const [probe] = await runProbes(
        [{ kind: "external", target, serviceId: path.serviceId }],
        probeExecutor,
        observation.observedAt
      );
      if (probe) pathProbes.set(path.domain.toLowerCase(), probe);
    }));
    next = { ...next, pathProbes };
    setLoopEngine(next);
    return NextResponse.json({ ...publicState(next), newEvents: events.length });
  } catch (err) {
    return errorResponse(err);
  }
}
