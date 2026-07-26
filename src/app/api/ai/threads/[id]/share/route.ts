import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAiThreadShare, revokeAiThreadShares } from "@/lib/ai-share";
import { handleApiError, HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

function threadIdFrom(value: string) {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id < 1) throw new HttpError("Invalid thread id", 400);
  return id;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req);
    const { id } = await params;
    const share = await createAiThreadShare(threadIdFrom(id), user.id);
    return NextResponse.json({
      url: `/shared/chat/${share.token}`,
      expiresAt: share.expiresAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req);
    const { id } = await params;
    const result = await revokeAiThreadShares(threadIdFrom(id), user.id);
    return NextResponse.json({ revoked: result.count });
  } catch (error) {
    return handleApiError(error);
  }
}
