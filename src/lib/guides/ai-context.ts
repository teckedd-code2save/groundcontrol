import { prisma } from "@/lib/prisma";
import { parseGuideSteps } from "@/lib/guides/loader";
import { getCompletedStepIds } from "@/lib/guides/progress";

export interface GuideContextInput {
  guideSlug: string;
  stepId?: string;
}

export async function formatGuideContextForPrompt(
  userId: number,
  ctx: GuideContextInput
): Promise<string> {
  const guide = await prisma.guide.findUnique({
    where: { slug: ctx.guideSlug, isPublished: true },
  });
  if (!guide) return "";

  const steps = parseGuideSteps(guide);
  const currentStep = steps.find((s) => s.id === ctx.stepId) || steps[0];
  const progress = await prisma.userGuideProgress.findUnique({
    where: { userId_guideId: { userId, guideId: guide.id } },
  });
  const completed = progress ? getCompletedStepIds(progress) : [];

  const lines = [
    "=== ACTIVE GUIDE CONTEXT ===",
    `Guide: ${guide.title} (${guide.category})`,
    `Description: ${guide.description}`,
  ];

  if (currentStep) {
    lines.push(`Current step: ${currentStep.id} — ${currentStep.title}`);
    lines.push(`Current step instructions:\n${currentStep.content}`);
    if (currentStep.checkCommand) {
      lines.push(`Available verification command: ${currentStep.checkCommand}`);
    }
    if (currentStep.aiHint) {
      lines.push(`Hint: ${currentStep.aiHint}`);
    }
  }

  if (completed.length > 0) {
    lines.push(`Completed steps: ${completed.join(", ")}`);
  }

  const remaining = steps.filter((s) => !completed.includes(s.id));
  if (remaining.length > 0) {
    lines.push(`Remaining steps: ${remaining.map((s) => s.title).join(" → ")}`);
  }

  lines.push(
    "Use this context to answer the user's question. You may run the available verification command through a tool if it helps validate the step. Do not advance the guide unless the user explicitly asks."
  );
  lines.push("=== END GUIDE CONTEXT ===");

  return lines.join("\n");
}
