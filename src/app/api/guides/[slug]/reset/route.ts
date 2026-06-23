import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { resetProgress, serializeProgress } from "@/lib/guides/progress";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const user = requireAuth(req);
    const { slug } = await params;

    const guide = await prisma.guide.findUnique({
      where: { slug, isPublished: true },
    });
    if (!guide) {
      return NextResponse.json({ error: "Guide not found" }, { status: 404 });
    }

    const progress = await resetProgress(user.id, guide.id);
    return NextResponse.json(serializeProgress(progress));
  } catch (err) {
    return handleApiError(err);
  }
}
