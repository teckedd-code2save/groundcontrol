import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { execOnTargetStrict } from "@/lib/host-exec";
import { getActiveVps, shQuote } from "@/lib/vps";
import { prisma } from "@/lib/prisma";
import { parseDetachedComposeRedeployLog } from "@/lib/compose-redeploy";

/**
 * GET /api/projects/compose/log?slug=groundcontrol
 *
 * Returns the last 200 lines from the redeploy log file.
 * Used by the UI to show live redeploy progress.
 */
export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    if (!slug || !/^[A-Za-z0-9_.-]+$/.test(slug)) {
      return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    }
    const logFile = `/tmp/gc-redeploy-${slug}.log`;
    const vps = await getActiveVps();
    const result = await execOnTargetStrict(
      `tail -n 200 ${shQuote(logFile)} 2>/dev/null || echo ""`,
      vps
    );
    const parsed = parseDetachedComposeRedeployLog(result.stdout || "");
    const { lines, status, error, exitCode } = parsed;

    // Reconcile the durable release records after a self-hosted detached
    // redeploy. This is idempotent and only advances the newest in-flight run.
    if (status !== "running") {
      const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
      const latestLog = await prisma.deploymentLog.findFirst({
        where: { projectSlug: slug, status: "running" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestLog) {
        await prisma.deploymentLog.update({
          where: { id: latestLog.id },
          data: {
            status,
            output: lines.join("\n").slice(-12000) || null,
            error: status === "failed" ? error : null,
          },
        });
      }
      if (project) {
        const latestRelease = await prisma.deployment.findFirst({
          where: { projectId: project.id, status: "deploying" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (latestRelease) {
          await prisma.deployment.update({
            where: { id: latestRelease.id },
            data: {
              status,
              output: lines.join("\n").slice(-12000) || null,
              error: status === "failed" ? error : null,
            },
          });
        }
      }
    }

    return NextResponse.json({
      slug,
      lines,
      count: lines.length,
      status,
      error,
      exitCode,
      complete: status !== "running",
    });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
