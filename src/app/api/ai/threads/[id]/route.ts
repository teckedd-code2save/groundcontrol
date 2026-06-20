import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getAiThread, deleteAiThread } from "@/lib/ai-memory";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req);
    const { id } = await params;
    const threadId = parseInt(id, 10);
    if (Number.isNaN(threadId)) {
      return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
    }
    const thread = await getAiThread(threadId, user.id);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    return NextResponse.json({ thread });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to get thread";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req);
    const { id } = await params;
    const threadId = parseInt(id, 10);
    if (Number.isNaN(threadId)) {
      return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
    }
    await deleteAiThread(threadId, user.id);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete thread";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
