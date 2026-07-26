import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { exportAiThread } from "@/lib/ai-share";
import { handleApiError, HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req);
    const { id } = await params;
    const threadId = Number.parseInt(id, 10);
    if (!Number.isInteger(threadId) || threadId < 1) throw new HttpError("Invalid thread id", 400);
    const format = req.nextUrl.searchParams.get("format") === "json" ? "json" : "markdown";
    const body = await exportAiThread(threadId, user.id, format);
    const extension = format === "json" ? "json" : "md";
    return new NextResponse(body, {
      headers: {
        "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="groundcontrol-chat-${threadId}.${extension}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
