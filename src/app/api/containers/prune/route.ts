import { NextRequest, NextResponse } from "next/server";
import { pruneDocker } from "@/lib/vps";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const result = await pruneDocker();
    const summary = result.output.trim() || result.error.trim() || "Prune executed";
    return NextResponse.json({ success: result.success, output: summary });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
