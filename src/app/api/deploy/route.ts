import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { execOnVps } from "@/lib/vps";

export async function GET() {
  const logs = await prisma.deploymentLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(logs);
}

export async function POST(req: NextRequest) {
  const { projectSlug, branch = "main" } = await req.json();

  const log = await prisma.deploymentLog.create({
    data: {
      projectSlug,
      branch,
      status: "running",
    },
  });

  // Trigger deploy via docker compose pull + up on the VPS
  // This runs in background; we return the log ID immediately
  const startTime = Date.now();

  (async () => {
    try {
      const projectPath = `/opt/${projectSlug}`;
      const result = await execOnVps(
        `cd ${projectPath} && docker compose pull && docker compose up -d --remove-orphans`
      );
      const duration = Date.now() - startTime;

      await prisma.deploymentLog.update({
        where: { id: log.id },
        data: {
          status: result.code === 0 ? "success" : "failed",
          output: result.stdout,
          error: result.stderr,
          durationMs: duration,
        },
      });
    } catch (err: any) {
      await prisma.deploymentLog.update({
        where: { id: log.id },
        data: {
          status: "failed",
          error: err.message,
          durationMs: Date.now() - startTime,
        },
      });
    }
  })();

  return NextResponse.json({ id: log.id, status: "running" });
}
