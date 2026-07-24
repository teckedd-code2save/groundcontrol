import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  getLoopEngine,
  setLoopEngine,
  listRuns,
  advanceToInvestigation,
  createHttpProbeExecutor,
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
 * Create / advance a Loop run through real journey execution and investigation.
 */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as {
      changeSetId?: string;
      runId?: string;
      domain?: string;
    };

    const domain = String(body.domain || "").trim();
    if (!domain) {
      return NextResponse.json({ error: "A live service domain is required." }, { status: 400 });
    }
    const state = getLoopEngine();
    const domainChangeSet = [...state.changeSets].reverse().find((changeSet) =>
      changeSet.eventIds.some((eventId) => {
        const event = state.events.find((candidate) => candidate.id === eventId);
        return String(event?.meta?.domain || "").toLowerCase() === domain.toLowerCase();
      })
    );
    const changeSetId = body.changeSetId || domainChangeSet?.id || state.changeSets.at(-1)?.id;
    if (!changeSetId) {
      return NextResponse.json(
        { error: "Scan this system first so GroundControl can attach the investigation to live evidence." },
        { status: 400 }
      );
    }

    const runId = body.runId || `run_${Date.now()}`;
    if (state.graph.source === "fixture") {
      return NextResponse.json({ error: "Fixture graph data cannot start production Loop runs." }, { status: 409 });
    }
    const probeExecutor = createHttpProbeExecutor();

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
      maturity: "early_access",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
