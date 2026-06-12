import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getServerIp } from "@/lib/bootstrap";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const ip = await getServerIp();
    return NextResponse.json({ ip });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
