import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runDeploy } from "@/lib/deploy/pipeline";
import { getActiveCloudProviderAccount } from "@/lib/cloud/accounts";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

async function resolveCloudRunTarget(targetId?: number) {
  if (targetId) {
    const target = await prisma.deploymentTarget.findUnique({ where: { id: targetId } });
    if (target) return target;
  }

  const active = await prisma.deploymentTarget.findFirst({
    where: { type: "cloudrun", isActive: true },
  });
  if (active) return active;

  const anyCloudRun = await prisma.deploymentTarget.findFirst({
    where: { type: "cloudrun" },
    orderBy: { createdAt: "desc" },
  });
  if (anyCloudRun) return anyCloudRun;

  return prisma.deploymentTarget.create({
    data: {
      name: "Cloud Run",
      type: "cloudrun",
      configJson: JSON.stringify({}),
      isActive: true,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const body = await req.json();
    const {
      projectSlug,
      targetId,
      branch,
      projectId,
      region,
      serviceName,
      cpu,
      memory,
      concurrency,
      maxInstances,
      minInstances,
      generatePreviewUrl,
    } = body;

    if (!projectSlug || typeof projectSlug !== "string") {
      return NextResponse.json({ error: "projectSlug is required" }, { status: 400 });
    }
    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!region || typeof region !== "string") {
      return NextResponse.json({ error: "region is required" }, { status: 400 });
    }
    if (!serviceName || typeof serviceName !== "string") {
      return NextResponse.json({ error: "serviceName is required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const account = await getActiveCloudProviderAccount("gcp");
    if (!account) {
      return NextResponse.json(
        { error: "No active GCP account configured. Add one in Settings → Cloud Accounts." },
        { status: 400 }
      );
    }

    const target = await resolveCloudRunTarget(targetId ? Number(targetId) : undefined);

    const configOverrides: Record<string, unknown> = {
      projectId,
      region,
      serviceName,
    };

    if (cpu !== undefined) configOverrides.cpu = cpu;
    if (memory !== undefined) configOverrides.memory = memory;
    if (concurrency !== undefined) configOverrides.concurrency = concurrency;
    if (maxInstances !== undefined) configOverrides.maxInstances = maxInstances;
    if (minInstances !== undefined) configOverrides.minInstances = minInstances;

    const id = await runDeploy({
      projectId: project.id,
      targetId: target.id,
      branch,
      generatePreviewUrl,
      configOverrides,
    });

    return NextResponse.json({ id, status: "running" });
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
