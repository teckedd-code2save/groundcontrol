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
      maturity: state.graph.nodes.length > 0 ? "live" : "awaiting_observation",
      note:
        state.graph.nodes.length === 0
          ? "No live service graph has been reconciled from the host yet."
          : undefined,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
