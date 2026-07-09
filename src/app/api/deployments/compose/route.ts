import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveVps, execOnVps, shQuote } from "@/lib/vps";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

    const vps = await getActiveVps();
    if (!vps) return NextResponse.json({ error: "No active VPS" }, { status: 400 });

    const result = await execOnVps(`cat ${shQuote(path)} 2>/dev/null || echo "compose file not found"`, vps);
    return NextResponse.json({ compose: result.stdout || "Not available", path });
  } catch (err) {
    return NextResponse.json({ compose: "Error", error: String(err) });
  }
}
