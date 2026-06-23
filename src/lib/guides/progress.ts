import { prisma } from "@/lib/prisma";
import { parseGuideSteps } from "@/lib/guides/loader";
import type { Guide, UserGuideProgress } from "@prisma/client";

export async function getOrCreateProgress(userId: number, guideId: number): Promise<UserGuideProgress> {
  const existing = await prisma.userGuideProgress.findUnique({
    where: { userId_guideId: { userId, guideId } },
  });
  if (existing) return existing;

  return prisma.userGuideProgress.create({
    data: {
      userId,
      guideId,
      status: "not_started",
      completedStepIds: "[]",
      currentStepId: "",
    },
  });
}

export function getCompletedStepIds(progress: UserGuideProgress): string[] {
  try {
    return JSON.parse(progress.completedStepIds) as string[];
  } catch {
    return [];
  }
}

export async function updateProgressStep(
  userId: number,
  guide: Guide,
  stepId: string,
  markComplete: boolean
): Promise<UserGuideProgress> {
  const steps = parseGuideSteps(guide);
  const stepIndex = steps.findIndex((s) => s.id === stepId);
  if (stepIndex === -1) {
    throw new Error("Step not found");
  }

  const progress = await getOrCreateProgress(userId, guide.id);
  const completed = new Set(getCompletedStepIds(progress));
  if (markComplete) {
    completed.add(stepId);
  }

  const nextStep = steps[stepIndex + 1];
  const currentStepId = nextStep?.id || stepId;
  const allCompleted = steps.length > 0 && steps.every((s) => completed.has(s.id));

  return prisma.userGuideProgress.update({
    where: { userId_guideId: { userId, guideId: guide.id } },
    data: {
      currentStepId,
      completedStepIds: JSON.stringify(Array.from(completed)),
      status: allCompleted ? "completed" : "in_progress",
      startedAt: progress.startedAt || new Date(),
      completedAt: allCompleted ? new Date() : progress.completedAt,
      updatedAt: new Date(),
    },
  });
}

export async function resetProgress(userId: number, guideId: number): Promise<UserGuideProgress> {
  return prisma.userGuideProgress.upsert({
    where: { userId_guideId: { userId, guideId } },
    update: {
      currentStepId: "",
      completedStepIds: "[]",
      status: "not_started",
      completedAt: null,
      updatedAt: new Date(),
    },
    create: {
      userId,
      guideId,
      currentStepId: "",
      completedStepIds: "[]",
      status: "not_started",
    },
  });
}

export function serializeProgress(progress: UserGuideProgress) {
  return {
    ...progress,
    completedStepIds: getCompletedStepIds(progress),
  };
}
