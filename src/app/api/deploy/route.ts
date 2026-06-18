import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runDeploy } from "@/lib/deploy/pipeline";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);

    const deployments = await prisma.deployment.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        project: { select: { slug: true, name: true } },
        target: { select: { name: true, type: true } },
      },
    });

    return NextResponse.json(deployments);
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const body = await req.json();
    const {
      projectSlug,
      targetId,
      branch,
      generatePreviewUrl,
      subdomain,
      zoneId,
      proxied,
      replicas,
      port,
      ingressClass,
      namespace,
      serviceType,
      projectId,
      region,
      serviceName,
      cpu,
      memory,
      concurrency,
      maxInstances,
      minInstances,
    } = body;

    if (!projectSlug || typeof projectSlug !== "string") {
      return NextResponse.json({ error: "projectSlug is required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const configOverrides: Record<string, unknown> = {};
    if (replicas !== undefined) configOverrides.replicas = replicas;
    if (port !== undefined) configOverrides.port = port;
    if (ingressClass !== undefined) configOverrides.ingressClass = ingressClass;
    if (namespace !== undefined) configOverrides.namespace = namespace;
    if (serviceType !== undefined) configOverrides.serviceType = serviceType;

    // Cloud Run specific overrides
    if (projectId !== undefined) configOverrides.projectId = projectId;
    if (region !== undefined) configOverrides.region = region;
    if (serviceName !== undefined) configOverrides.serviceName = serviceName;
    if (cpu !== undefined) configOverrides.cpu = cpu;
    if (memory !== undefined) configOverrides.memory = memory;
    if (concurrency !== undefined) configOverrides.concurrency = concurrency;
    if (maxInstances !== undefined) configOverrides.maxInstances = maxInstances;
    if (minInstances !== undefined) configOverrides.minInstances = minInstances;

    const id = await runDeploy({
      projectId: project.id,
      targetId,
      branch,
      generatePreviewUrl,
      subdomain,
      zoneId,
      proxied,
      configOverrides: Object.keys(configOverrides).length > 0 ? configOverrides : undefined,
    });

    return NextResponse.json({ id, status: "running" });
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
