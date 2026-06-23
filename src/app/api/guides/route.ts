import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeProgress } from "@/lib/guides/progress";

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const guides = await prisma.guide.findMany({
      where: { isPublished: true },
      orderBy: [{ category: "asc" }, { title: "asc" }],
    });

    const progressRecords = await prisma.userGuideProgress.findMany({
      where: { userId: user.id },
    });

    const progressByGuideId = new Map(progressRecords.map((p) => [p.guideId, serializeProgress(p)]));

    const enriched = guides.map((guide) => ({
      ...guide,
      progress: progressByGuideId.get(guide.id) || {
        status: "not_started",
        currentStepId: "",
        completedStepIds: [],
      },
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    return handleApiError(err);
  }
}
