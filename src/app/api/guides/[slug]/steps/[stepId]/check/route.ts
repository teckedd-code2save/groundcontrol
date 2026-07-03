import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { execOnTarget } from "@/lib/host-exec";
import { getActiveVps, getKubeconfigEnv } from "@/lib/vps";
import { parseGuideSteps } from "@/lib/guides/loader";
import { updateProgressStep, serializeProgress } from "@/lib/guides/progress";

function isKubernetesApiUnavailable(command: string, output: string): boolean {
  if (!/\bkubectl\b/.test(command)) return false;
  return (
    /127\.0\.0\.1:6443.*connect: connection refused/i.test(output) ||
    /localhost:8080.*connect: connection refused/i.test(output) ||
    /The connection to the server .* was refused/i.test(output)
  );
}

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

    const activeVps = await getActiveVps();
    const command = `export ${getKubeconfigEnv(activeVps)}; ${step.checkCommand}`;
    const result = await execOnTarget(command, activeVps);
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    const ok = result.code === 0;

    if (!ok && isKubernetesApiUnavailable(step.checkCommand, combined)) {
      return NextResponse.json({
        ok: false,
        skipped: true,
        message:
          "kubectl is installed and the k3s kubeconfig was found, but the k3s API is not reachable at 127.0.0.1:6443. Start or reinstall k3s, then run this check again.",
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
        expectedOutput: step.expectedOutput || null,
        matchesExpected: false,
        progress: null,
      });
    }

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
