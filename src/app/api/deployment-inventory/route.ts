import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { scanProjectsTree } from "@/lib/project-scan";
import {
  execOnVps,
  getActiveVps,
  getDockerContainerLabels,
  getDockerContainers,
  shQuote,
} from "@/lib/vps";

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "deployment";
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const vps = await getActiveVps();
    const [tree, containers, labels, projects, enrolled] = await Promise.all([
      scanProjectsTree(vps),
      getDockerContainers(vps),
      getDockerContainerLabels(vps),
      prisma.projectGroup.findMany({ orderBy: { name: "asc" } }),
      prisma.enrolledDeployment.findMany({
        where: { vpsConfigId: vps?.id ?? null },
        include: {
          projectGroup: true,
          legacyProject: {
            include: {
              deployments: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
        orderBy: [{ projectGroupId: "asc" }, { name: "asc" }],
      }),
    ]);

    const enrolledPaths = new Set(enrolled.map((item) => item.sourcePath).filter(Boolean));
    const enrolledContainers = new Set(enrolled.map((item) => item.containerName).filter(Boolean));
    const discoveredProjectPaths = new Set(tree.projects.map((item) => item.path));
    const labelsByName = new Map(labels.map((item) => [item.name, item]));

    const folderCandidates = tree.projects
      .filter((item) => !enrolledPaths.has(item.path))
      .map((item) => ({
        id: `folder:${item.path}`,
        kind: "compose",
        name: item.name,
        sourcePath: item.path,
        composePath: item.composePath,
        components: item.services.length,
        evidence: [item.hasGit ? "Git repository" : null, `${item.services.length} Compose components`, item.domain ? `Route ${item.domain}` : null].filter(Boolean),
      }));

    const containerCandidates = containers
      .filter((item) => !enrolledContainers.has(item.name))
      .filter((item) => {
        const workingDir = labelsByName.get(item.name)?.workingDir;
        return !workingDir || (!enrolledPaths.has(workingDir) && !discoveredProjectPaths.has(workingDir));
      })
      .map((item) => {
        const label = labelsByName.get(item.name);
        return {
          id: `container:${item.name}`,
          kind: label?.workingDir ? "compose" : "container",
          name: label?.project || item.name,
          containerName: item.name,
          sourcePath: label?.workingDir || null,
          composePath: label?.configFiles?.split(",")[0] || null,
          state: item.state,
          image: item.image,
          evidence: [label?.workingDir ? `Compose source ${label.workingDir}` : "Standalone container", label?.service ? `Service ${label.service}` : null, `Image ${item.image}`].filter(Boolean),
        };
      });

    const liveNames = new Set(containers.map((item) => item.name));
    return NextResponse.json({
      projects,
      deployments: enrolled.map((item) => {
        const latestRelease = item.legacyProject?.deployments[0] || null;
        return {
          ...item,
          project: item.projectGroup,
          projectId: item.projectGroupId,
          legacyProjectSlug: item.legacyProject?.slug || null,
          repoUrl: item.legacyProject?.repoUrl || null,
          domain: item.legacyProject?.domain || null,
          publicUrl: latestRelease?.publicUrl || latestRelease?.previewUrl || null,
          latestRelease: latestRelease ? {
            id: latestRelease.id,
            status: latestRelease.status,
            commitSha: latestRelease.commitSha,
            createdAt: latestRelease.createdAt,
          } : null,
          observedStatus: item.containerName
            ? liveNames.has(item.containerName) ? "present" : "missing"
            : tree.projects.some((candidate) => candidate.path === item.sourcePath) ? "present" : "missing",
        };
      }),
      candidates: [...folderCandidates, ...containerCandidates],
      discoveryError: tree.error || null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const action = String(body.action || "");
    const vps = await getActiveVps();

    if (action === "create_project") {
      const name = String(body.name || "").trim();
      if (!name) return NextResponse.json({ error: "Project name is required" }, { status: 400 });
      const project = await prisma.projectGroup.create({
        data: { name, slug: slugify(name), description: String(body.description || "") },
      });
      return NextResponse.json({ project }, { status: 201 });
    }

    if (action === "assign_project") {
      const deploymentId = Number(body.deploymentId || 0);
      const projectId = body.projectId ? Number(body.projectId) : null;
      const deployment = await prisma.enrolledDeployment.update({
        where: { id: deploymentId },
        data: { projectGroupId: projectId },
        include: { projectGroup: true },
      });
      return NextResponse.json({ deployment });
    }

    if (action === "unenroll") {
      await prisma.enrolledDeployment.delete({ where: { id: Number(body.deploymentId || 0) } });
      return NextResponse.json({ ok: true });
    }

    if (action !== "enroll") return NextResponse.json({ error: "Unsupported action" }, { status: 400 });

    const sourcePath = body.sourcePath ? String(body.sourcePath).replace(/\/+$/, "") : null;
    const containerName = body.containerName ? String(body.containerName) : null;
    if (!sourcePath && !containerName) return NextResponse.json({ error: "A folder or container is required" }, { status: 400 });

    let kind = String(body.kind || (sourcePath ? "folder" : "container"));
    const composePath = body.composePath ? String(body.composePath) : null;
    let composeContent = "";
    if (sourcePath) {
      if (!sourcePath.startsWith("/")) return NextResponse.json({ error: "Deployment folder must be absolute" }, { status: 400 });
      if (composePath) {
        const result = await execOnVps(`cat ${shQuote(composePath)} 2>/dev/null || true`, vps);
        composeContent = result.stdout || "";
        if (composeContent.trim()) kind = "compose";
      }
    }

    const baseName = String(body.name || sourcePath?.split("/").pop() || containerName || "deployment");
    const slugBase = slugify(baseName);
    let slug = slugBase;
    let suffix = 1;
    while (await prisma.enrolledDeployment.findUnique({ where: { slug } })) slug = `${slugBase}-${++suffix}`;

    let legacyProjectId: number | null = null;
    if (sourcePath) {
      const existingLegacy = await prisma.project.findFirst({ where: { path: sourcePath } });
      const legacy = existingLegacy
        ? await prisma.project.update({
            where: { id: existingLegacy.id },
            data: { name: baseName, dockerCompose: composeContent || undefined },
          })
        : await prisma.project.create({
            data: { slug, name: baseName, path: sourcePath, dockerCompose: composeContent || null, category: kind === "compose" ? "docker" : "app" },
          });
      legacyProjectId = legacy.id;
    }

    const deployment = await prisma.enrolledDeployment.create({
      data: {
        name: baseName,
        slug,
        kind,
        managementMode: body.managementMode === "managed" ? "managed" : "track",
        sourcePath,
        composePath,
        containerName,
        projectGroupId: body.projectId ? Number(body.projectId) : null,
        vpsConfigId: vps?.id ?? null,
        legacyProjectId,
        status: "observed",
        lastSeenAt: new Date(),
        metadataJson: JSON.stringify({ image: body.image || null, enrolledFrom: containerName ? "container" : "folder" }),
      },
      include: { projectGroup: true },
    });
    return NextResponse.json({ deployment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
