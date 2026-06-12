import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listZones } from "@/lib/cloudflare";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const zones = await listZones();
    return NextResponse.json(zones);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
