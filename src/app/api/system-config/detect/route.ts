import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { probeServerLayout } from "@/lib/server-probe";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const layout = await probeServerLayout();
    return NextResponse.json(layout);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
