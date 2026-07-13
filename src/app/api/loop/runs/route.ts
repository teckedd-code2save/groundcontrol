import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  getLoopEngine,
  setLoopEngine,
  listRuns,
  advanceToInvestigation,
  createMapProbeExecutor,
  fixtureWrongUpstreamPort,
} from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return NextResponse.json({ runs: listRuns() });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Create / advance a Loop run through journey execution and investigation.
 * Uses fixture probe map when graph source is fixture.
 */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as {
      changeSetId?: string;
      runId?: string;
      domain?: string;
      /** Fixture HTTP status for public URL (default 502 for broken demos). */
      probeStatus?: number;
    };

    const state = getLoopEngine();
    const changeSetId = body.changeSetId || state.changeSets[0]?.id;
    if (!changeSetId) {
      return NextResponse.json(
        { error: "No change set available. Load a fixture or ingest events first." },
        { status: 400 }
      );
    }

    const runId = body.runId || `run_${Date.now()}`;
    const domain = body.domain || "app.example.com";
    const fx = fixtureWrongUpstreamPort();
    const status = body.probeStatus ?? 502;
    const probeExecutor = createMapProbeExecutor({
      [fx.publicUrl]: status,
      "https://api.example.com/health": status,
    });

    const result = await advanceToInvestigation({
      state,
      runId,
      changeSetId,
      probeExecutor,
      domain,
    });
    setLoopEngine(result.state);

    return NextResponse.json({
      run: result.run,
      maturity: result.run.isFixture ? "fixture" : "early_access",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
