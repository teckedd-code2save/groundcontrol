import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLoopEngine, getGraphSummary } from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

/** GET read-only service graph + domain paths. No host mutations. */
export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const state = getLoopEngine();
    const summary = getGraphSummary(state);
    return NextResponse.json({
      ...summary,
      maturity: state.graph.source === "fixture" ? "fixture" : "live",
      note:
        state.graph.nodes.length === 0
          ? "No graph loaded. POST /api/intelligence/fixtures/load or reconcile from host."
          : undefined,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
