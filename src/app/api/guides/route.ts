import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeProgress } from "@/lib/guides/progress";
import { upsertGuidesFromDisk } from "@/lib/guides/loader";

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req);
    let guides = await prisma.guide.findMany({
      where: { isPublished: true },
      orderBy: [{ category: "asc" }, { title: "asc" }],
    });

    // Self-healing: if no guides are in the DB, load them from disk automatically.
    // This avoids requiring a manual `npm run db:seed` in every deployment environment.
    if (guides.length === 0) {
      await upsertGuidesFromDisk();
      guides = await prisma.guide.findMany({
        where: { isPublished: true },
        orderBy: [{ category: "asc" }, { title: "asc" }],
      });
    }

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
