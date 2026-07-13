import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  fixtureWrongUpstreamPort,
  fixtureContainerDown,
  getLoopEngine,
  setLoopEngine,
  createEngineState,
  ingestObservation,
  ingestEvents,
  registerJourney,
  registerRevision,
  captureLastKnownHealthy,
  getServicePath,
} from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

/**
 * Load a deterministic fixture into the Loop engine for demo/evaluation.
 * Labelled as fixture — not live host state.
 */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as { fixture?: string };
    const name = body.fixture || "wrong_upstream";

    let state = createEngineState();

    if (name === "container_down") {
      const fx = fixtureContainerDown();
      state = ingestObservation(state, fx.observation);
      state = registerJourney(state, fx.journey);
      state = ingestEvents(state, fx.events, 1000);
      setLoopEngine(state);
      return NextResponse.json({
        ok: true,
        fixture: fx.id,
        label: fx.label,
        maturity: "fixture",
        changeSetId: state.changeSets[0]?.id,
        domain: "api.example.com",
        publicUrl: fx.publicUrl,
      });
    }

    const fx = fixtureWrongUpstreamPort();
    state = ingestObservation(state, fx.healthyObservation);
    state = registerRevision(state, fx.healthyRevision);
    state = registerRevision(state, fx.brokenRevision);
    state = registerJourney(state, fx.journey);

    const path = getServicePath(state, "app.example.com");
    if (path) {
      const snap = captureLastKnownHealthy({
        hostId: fx.healthyObservation.hostId,
        path,
        probes: [
          {
            id: "fixture_probe_ok",
            kind: "external",
            target: fx.publicUrl,
            ok: true,
            statusCode: 200,
            observedAt: fx.healthyObservation.observedAt,
          },
        ],
        proxyRevisionId: fx.healthyRevision.id,
        capturedAt: fx.healthyObservation.observedAt,
      });
      if (snap) state.lastHealthy.put(snap);
    }

    // Advance to broken state for investigation demos
    state = ingestObservation(state, fx.brokenObservation);
    state = ingestEvents(state, fx.events, 1000);

    setLoopEngine(state);
    // touch global so getLoopEngine sees it
    void getLoopEngine();

    return NextResponse.json({
      ok: true,
      fixture: fx.id,
      label: fx.label,
      maturity: "fixture",
      changeSetId: state.changeSets[0]?.id,
      domain: "app.example.com",
      publicUrl: fx.publicUrl,
      note: "Fixture data — not live host integrations. Use Loop run APIs to investigate and recover.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
