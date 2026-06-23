import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { updateProgressStep, serializeProgress } from "@/lib/guides/progress";

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

    const body = await req.json().catch(() => ({}));
    const { stepId, markComplete = true } = body;
    if (!stepId || typeof stepId !== "string") {
      return NextResponse.json({ error: "stepId is required" }, { status: 400 });
    }

    const progress = await updateProgressStep(user.id, guide, stepId, markComplete);
    return NextResponse.json(serializeProgress(progress));
  } catch (err) {
    return handleApiError(err);
  }
}
