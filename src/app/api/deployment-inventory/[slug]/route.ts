import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getActiveVps, getDockerContainerLabels, getDockerContainers } from "@/lib/vps";
import { linkDeploymentRuntime } from "@/lib/deployment-runtime-link";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    requireAuth(req);
    const { slug } = await ctx.params;
    const vps = await getActiveVps();
    const [deployment, containers, labels, projects] = await Promise.all([
      prisma.enrolledDeployment.findUnique({
        where: { slug },
        include: {
          projectGroup: true,
          legacyProject: {
            include: {
              deployments: {
                orderBy: { createdAt: "desc" },
                take: 20,
                include: { target: true },
              },
              envProfiles: {
                orderBy: { updatedAt: "desc" },
                take: 1,
              },
            },
          },
        },
      }),
      getDockerContainers(vps),
      getDockerContainerLabels(vps),
      prisma.projectGroup.findMany({ orderBy: { name: "asc" } }),
    ]);

    if (!deployment) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }

    const liveNames = new Set(containers.map((container) => container.name));
    const releases = deployment.legacyProject?.deployments || [];
    const latestRelease = releases[0] || null;
    const runtime = linkDeploymentRuntime(deployment, containers, labels);
    return NextResponse.json({
      deployment: {
        ...deployment,
        project: deployment.projectGroup,
        projectId: deployment.projectGroupId,
        legacyProjectSlug: deployment.legacyProject?.slug || null,
        repoUrl: deployment.legacyProject?.repoUrl || null,
        domain: deployment.legacyProject?.domain || null,
        publicUrl: latestRelease?.publicUrl || latestRelease?.previewUrl || (deployment.legacyProject?.domain ? `https://${deployment.legacyProject.domain}` : null),
        runtime,
        releases,
        envProfile: deployment.legacyProject?.envProfiles[0] || null,
        observedStatus: runtime.status === "present" || deployment.kind === "static" && Boolean(deployment.legacyProject)
          ? "present" : deployment.containerName && liveNames.has(deployment.containerName) ? "present" : "missing",
      },
      projects,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
