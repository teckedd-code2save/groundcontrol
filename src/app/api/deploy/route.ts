import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { execOnVps, getDockerComposeCommand, getSystemConfig } from "@/lib/vps";
import { createAlert } from "@/lib/alerts";

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
      const config = await getSystemConfig();
      const projectPath = `${config.projectRoot}/${projectSlug}`;
      let composeCmd = await getDockerComposeCommand();

      let result = await execOnVps(
        `cd ${projectPath} && ${composeCmd} pull && ${composeCmd} up -d --remove-orphans`
      );

      // Fallback: if plugin syntax fails for any reason, try standalone
      if (result.code !== 0) {
        composeCmd = "docker-compose";
        result = await execOnVps(
          `cd ${projectPath} && ${composeCmd} pull && ${composeCmd} up -d --remove-orphans`
        );
      }

      const duration = Date.now() - startTime;
      const status = result.code === 0 ? "success" : "failed";

      await prisma.deploymentLog.update({
        where: { id: log.id },
        data: {
          status,
          output: result.stdout,
          error: result.stderr,
          durationMs: duration,
        },
      });

      if (status === "failed") {
        await createAlert({
          title: `Deploy Failed: ${projectSlug}`,
          message: result.stderr || "Docker compose deploy failed. Check logs for details.",
          severity: "error",
          source: "deploy",
        });
      }
    } catch (err: any) {
      await prisma.deploymentLog.update({
        where: { id: log.id },
        data: {
          status: "failed",
          error: err.message,
          durationMs: Date.now() - startTime,
        },
      });

      await createAlert({
        title: `Deploy Failed: ${projectSlug}`,
        message: err.message,
        severity: "error",
        source: "deploy",
      });
    }
  })();

  return NextResponse.json({ id: log.id, status: "running" });
}
