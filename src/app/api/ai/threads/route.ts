import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listAiThreads, createAiThread } from "@/lib/ai-memory";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const threads = await listAiThreads(user.id);
    return NextResponse.json({ threads });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list threads";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as { title?: string };
    const thread = await createAiThread(user.id, body.title);
    return NextResponse.json({ thread });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create thread";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
