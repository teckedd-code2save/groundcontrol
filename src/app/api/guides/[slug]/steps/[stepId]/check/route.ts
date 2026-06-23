import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { execOnVps } from "@/lib/vps";
import { parseGuideSteps } from "@/lib/guides/loader";
import { updateProgressStep, serializeProgress } from "@/lib/guides/progress";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; stepId: string }> }
) {
  try {
    const user = requireAuth(req);
    const { slug, stepId } = await params;

    const guide = await prisma.guide.findUnique({
      where: { slug, isPublished: true },
    });
    if (!guide) {
      return NextResponse.json({ error: "Guide not found" }, { status: 404 });
    }

    const steps = parseGuideSteps(guide);
    const step = steps.find((s) => s.id === stepId);
    if (!step) {
      return NextResponse.json({ error: "Step not found" }, { status: 404 });
    }

    if (!step.checkCommand) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: "This step has no automatic check.",
      });
    }

    const result = await execOnVps(step.checkCommand);
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    const ok = result.code === 0;

    // Optionally match expected output substring/regex.
    let matchesExpected = true;
    if (ok && step.expectedOutput) {
      try {
        const regex = new RegExp(step.expectedOutput, "i");
        matchesExpected = regex.test(combined);
      } catch {
        matchesExpected = combined.toLowerCase().includes(step.expectedOutput.toLowerCase());
      }
    }

    const passed = ok && matchesExpected;

    // Auto-advance progress when the check passes.
    let progress = null;
    if (passed) {
      progress = serializeProgress(await updateProgressStep(user.id, guide, stepId, true));
    }

    return NextResponse.json({
      ok: passed,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      expectedOutput: step.expectedOutput || null,
      matchesExpected,
      progress,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
