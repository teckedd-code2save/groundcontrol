import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLoopEngine } from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

/** GET change ledger (debounced change sets + raw events). Read-only. */
export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const state = getLoopEngine();
    return NextResponse.json({
      changeSets: state.changeSets,
      events: state.events,
      lastHealthy: state.lastHealthy.all(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
