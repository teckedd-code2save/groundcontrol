import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRun } from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req);
    const { id } = await ctx.params;
    const run = getRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    if (run.isFixture) {
      return NextResponse.json({ error: "Test-only runs are not available in the production intelligence workspace" }, { status: 404 });
    }
    return NextResponse.json({
      run,
      maturity: "early_access",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
