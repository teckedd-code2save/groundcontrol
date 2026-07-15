import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getActiveVps, getDockerContainers } from "@/lib/vps";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    requireAuth(req);
    const { slug } = await ctx.params;
    const vps = await getActiveVps();
    const [deployment, containers, projects] = await Promise.all([
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
      prisma.projectGroup.findMany({ orderBy: { name: "asc" } }),
    ]);

    if (!deployment) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }

    const liveNames = new Set(containers.map((container) => container.name));
    const releases = deployment.legacyProject?.deployments || [];
    const latestRelease = releases[0] || null;
    return NextResponse.json({
      deployment: {
        ...deployment,
        project: deployment.projectGroup,
        projectId: deployment.projectGroupId,
        legacyProjectSlug: deployment.legacyProject?.slug || null,
        repoUrl: deployment.legacyProject?.repoUrl || null,
        domain: deployment.legacyProject?.domain || null,
        publicUrl: latestRelease?.publicUrl || latestRelease?.previewUrl || null,
        releases,
        envProfile: deployment.legacyProject?.envProfiles[0] || null,
        observedStatus: deployment.containerName
          ? liveNames.has(deployment.containerName) ? "present" : "missing"
          : ["active", "observed"].includes(deployment.status) ? "present" : deployment.status,
      },
      projects,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
