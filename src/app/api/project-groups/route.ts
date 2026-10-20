import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { repositoryUrl } from "@/lib/project-settings";
import { handleApiError } from "@/lib/errors";
import { getActiveVps } from "@/lib/vps";
import { isDesktopMode } from "@/lib/runtime";
import { readDeploymentOverrides } from "@/lib/deployment-evidence";
import { prisma } from "@/lib/prisma";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const [projectGroups, ungroupedDeployments] = await Promise.all([
      prisma.projectGroup.findMany({
        orderBy: { name: "asc" },
        include: {
          sources: { include: { vpsConfig: { select: { name: true, isLocal: true } } } },
          enrolledDeployments: {
            where: { kind: { not: "source" } },
            orderBy: { name: "asc" },
            include: {
              vpsConfig: { select: { name: true, isLocal: true } },
              legacyProject: {
                include: {
                  deployments: { orderBy: { createdAt: "desc" }, take: 1 },
                },
              },
            },
          },
        },
      }),
      prisma.enrolledDeployment.findMany({
        where: { projectGroupId: null, kind: { not: "source" } },
        orderBy: { name: "asc" },
        include: {
          vpsConfig: { select: { name: true, isLocal: true } },
          legacyProject: {
            include: {
              deployments: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      }),
    ]);
    const summarize = (deployment: (typeof ungroupedDeployments)[number]) => {
      const latestRelease = deployment.legacyProject?.deployments[0] || null;
      return {
        id: deployment.id,
        slug: deployment.slug,
        name: deployment.name,
        path: deployment.sourcePath || deployment.containerName || "",
        domain: deployment.legacyProject?.domain || null,
        publicUrl: readDeploymentOverrides(deployment.metadataJson).publicUrl || latestRelease?.publicUrl || latestRelease?.previewUrl || null,
        repoUrl: deployment.legacyProject?.repoUrl || null,
        status: deployment.status,
        environmentName: deployment.environmentName,
        method: deployment.kind,
        hostId: deployment.vpsConfigId,
        hostName: deployment.vpsConfig?.name || "Connection unavailable",
        lastDeploy: latestRelease?.createdAt || deployment.lastSeenAt,
      };
    };
    const projects = projectGroups.map(({ enrolledDeployments, sources, ...project }) => ({
      ...project,
      deployments: enrolledDeployments.map(summarize),
      sources: sources.map((source) => {
        let technologies: string[] = [];
        try { technologies = JSON.parse(source.metadataJson).sourceProject?.technologies || []; } catch {}
        return { id: source.id, path: source.path, hostId: source.vpsConfigId, hostName: source.vpsConfig.name, technologies };
      }),
    }));
    const ungrouped = ungroupedDeployments.map(summarize);
    const vps = await getActiveVps();
    const activeHost = vps ? await prisma.vpsConfig.findUnique({ where: { id: vps.id }, select: { name: true } }) : null;
    return NextResponse.json({ projects, ungrouped, localDesktop: Boolean(isDesktopMode() && vps?.isLocal), hostId: vps?.id ?? null, hostName: activeHost?.name || "No connection" });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    const slug = slugify(String(body.slug || name));
    if (!slug) return NextResponse.json({ error: "Project slug is required" }, { status: 400 });
    const project = await prisma.projectGroup.create({
      data: {
        name: name.slice(0, 120),
        slug,
        repositoryUrl: repositoryUrl(body.repositoryUrl),
        description: String(body.description || "").trim(),
      },
      include: { enrolledDeployments: true },
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
