import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getOrCreateProgress, serializeProgress } from "@/lib/guides/progress";
import { parseGuideSteps, upsertGuidesFromDisk } from "@/lib/guides/loader";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const user = requireAuth(req);
    const { slug } = await params;

    let guide = await prisma.guide.findUnique({
      where: { slug, isPublished: true },
    });

    // Self-healing: seed guides from disk if this one is missing.
    if (!guide) {
      const count = await prisma.guide.count();
      if (count === 0) {
        await upsertGuidesFromDisk();
        guide = await prisma.guide.findUnique({
          where: { slug, isPublished: true },
        });
      }
    }

    if (!guide) {
      return NextResponse.json({ error: "Guide not found" }, { status: 404 });
    }

    const progress = await getOrCreateProgress(user.id, guide.id);
    const steps = parseGuideSteps(guide);

    // If the user is starting, default currentStepId to the first step.
    let currentStepId = progress.currentStepId;
    if (!currentStepId && steps.length > 0 && progress.status === "not_started") {
      currentStepId = steps[0].id;
    }

    return NextResponse.json({
      ...guide,
      steps,
      progress: {
        ...serializeProgress(progress),
        currentStepId,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
