import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runHealthCheck } from "@/lib/health-checks";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const summary = await runHealthCheck();
    return NextResponse.json(summary);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
