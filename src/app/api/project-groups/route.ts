import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
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
          enrolledDeployments: {
            orderBy: { name: "asc" },
            include: {
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
        where: { projectGroupId: null },
        orderBy: { name: "asc" },
        include: {
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
        publicUrl: latestRelease?.publicUrl || latestRelease?.previewUrl || null,
        repoUrl: deployment.legacyProject?.repoUrl || null,
        status: deployment.status,
        lastDeploy: latestRelease?.createdAt || deployment.lastSeenAt,
      };
    };
    const projects = projectGroups.map(({ enrolledDeployments, ...project }) => ({
      ...project,
      deployments: enrolledDeployments.map(summarize),
    }));
    const ungrouped = ungroupedDeployments.map(summarize);
    return NextResponse.json({ projects, ungrouped });
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
        name,
        slug,
        description: String(body.description || "").trim(),
      },
      include: { enrolledDeployments: true },
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
