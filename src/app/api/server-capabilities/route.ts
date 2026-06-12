import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { detectServerCapabilities } from "@/lib/server-capabilities";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const caps = await detectServerCapabilities();
    return NextResponse.json(caps);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
