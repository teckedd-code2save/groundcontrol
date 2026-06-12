import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { installNode } from "@/lib/bootstrap";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const result = await installNode();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, output: "", error: message }, { status: 500 });
  }
}
