import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { scanProjectsTree } from "@/lib/project-scan";
import {
  getActiveVps,
  getDockerContainerLabels,
  getDockerContainers,
  scanProjects,
} from "@/lib/vps";
import { isDesktopMode } from "@/lib/runtime";
import { scanSourceFolder } from "@/lib/source-discovery";
import { browseProjectFolders } from "@/lib/project-folder-browser";
import { addSourceProject, discoverSourceProjects } from "@/lib/source-projects";
import { buildInventoryCandidates, candidateIdentity, dismissedSuggestions, dismissalPrefix, setSuggestionHidden, untrackedProjectIds, untrackedProjectKey } from "@/lib/inventory-discovery";
import { launchLocalProject } from "@/lib/local-project-launch";
import { connectExistingDeployment } from "@/lib/project-deployments";
import { resolveDeploymentEvidence } from "@/lib/deployment-evidence";

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "deployment";
}

async function reconcileKnownDeployments(vpsConfigId: number | null) {
  const projects = await prisma.project.findMany({
    where: { inventoryRecord: null },
    orderBy: { createdAt: "asc" },
  });
  const [hidden, untracked] = await Promise.all([dismissedSuggestions(vpsConfigId), untrackedProjectIds(vpsConfigId)]);
  for (const project of projects) {
    if (untracked.has(project.id)) continue;
    let saved: { source?: { sourcePath?: string }; composeProject?: string } = {};
    try { saved = JSON.parse(project.envVars || "{}"); } catch {}
    let slug = project.slug;
    const collision = await prisma.enrolledDeployment.findUnique({ where: { slug } });
    if (collision) slug = `${project.slug}-${project.id}`;
    const sourcePath = saved.source?.sourcePath || project.path;
    if (hidden.has(candidateIdentity({ sourcePath }))) continue;
    const siblings = await prisma.enrolledDeployment.findMany({ where: { vpsConfigId, sourcePath, kind: { not: "source" } } });
    const existingIdentity = siblings.find((item) => saved.composeProject ? candidateIdentity(item) === `compose:${saved.composeProject}` : candidateIdentity(item) === `folder:${sourcePath}`);
    if (existingIdentity && !existingIdentity.legacyProjectId) {
      await prisma.enrolledDeployment.update({
        where: { id: existingIdentity.id },
        data: {
          name: project.name,
          kind: project.category === "static" ? "static" : project.dockerCompose ? "compose" : "app",
          managementMode: "managed",
          composePath: project.dockerCompose ? `${sourcePath}/docker-compose.yml` : existingIdentity.composePath,
          projectGroupId: project.projectGroupId,
          legacyProjectId: project.id,
          metadataJson: JSON.stringify({ source: "existing-groundcontrol-project", composeProject: saved.composeProject || null }),
        },
      });
      continue;
    }
    if (existingIdentity) continue;
    await prisma.enrolledDeployment.create({
      data: {
        name: project.name,
        slug,
        kind: project.category === "static" ? "static" : project.dockerCompose ? "compose" : "app",
        managementMode: "managed",
        sourcePath,
        composePath: project.dockerCompose ? `${sourcePath}/docker-compose.yml` : null,
        projectGroupId: project.projectGroupId,
        vpsConfigId,
        legacyProjectId: project.id,
        status: project.status,
        lastSeenAt: project.lastDeploy,
        metadataJson: JSON.stringify({ source: "existing-groundcontrol-project", composeProject: saved.composeProject || null }),
      },
    });
  }
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const vps = await getActiveVps();
    await reconcileKnownDeployments(vps?.id ?? null);
    const desktop = isDesktopMode() && vps?.isLocal;
    const [tree, containers, labels, projects, enrolled, hostProjects, sources, hidden] = await Promise.all([
      desktop ? Promise.resolve({ projects: [], error: undefined }) : scanProjectsTree(vps),
      getDockerContainers(vps),
      getDockerContainerLabels(vps),
      prisma.projectGroup.findMany({ orderBy: { name: "asc" } }),
      prisma.enrolledDeployment.findMany({
        where: { vpsConfigId: vps?.id ?? null, kind: { not: "source" } },
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
      desktop ? Promise.resolve({ caddySites: [] }) : scanProjects(vps),
      discoverSourceProjects(vps),
      dismissedSuggestions(vps?.id ?? null),
    ]);

    const savedSources = await prisma.projectSource.findMany({ where: { vpsConfigId: vps?.id ?? undefined }, select: { path: true } });
    const candidates = buildInventoryCandidates(tree.projects, sources.projects, containers, labels, enrolled).filter((item) => item.kind !== "source" || !savedSources.some((source) => source.path === item.sourcePath));

    return NextResponse.json({
      projects,
      deployments: enrolled.map((item) => {
        const latestRelease = item.legacyProject?.deployments[0] || null;
        const evidence = resolveDeploymentEvidence({
          ...item,
          savedDomain: item.legacyProject?.domain,
          savedRepoUrl: item.legacyProject?.repoUrl,
          legacyProjectPath: item.legacyProject?.path,
          legacyProjectSlug: item.legacyProject?.slug,
        }, containers, labels, tree.projects, hostProjects.caddySites);
        const runtime = evidence.runtime;
        const scanned = tree.projects.find((candidate) => candidate.path === item.sourcePath);
        return {
          ...item,
          project: item.projectGroup,
          projectId: item.projectGroupId,
          legacyProjectSlug: item.legacyProject?.slug || null,
          repoUrl: evidence.repoUrl,
          domain: item.legacyProject?.domain || evidence.route?.domain || null,
          publicUrl: evidence.publicUrl || latestRelease?.publicUrl || latestRelease?.previewUrl || null,
          runtime,
          route: evidence.route,
          identitySource: evidence.identitySource,
          latestRelease: latestRelease ? {
            id: latestRelease.id,
            status: latestRelease.status,
            commitSha: latestRelease.commitSha,
            createdAt: latestRelease.createdAt,
          } : null,
          observedStatus: item.kind === "source" && runtime.status !== "present" ? "source-only" : runtime.status === "present" || Boolean(scanned) || item.kind === "static" && Boolean(item.legacyProject)
            ? "present" : "missing",
        };
      }),
      candidates: candidates.filter((item) => !hidden.has(item.id) && !(item.sourcePath && hidden.has(`folder:${item.sourcePath}`))),
      hiddenCount: hidden.size,
      localDesktop: Boolean(desktop),
      hostId: vps?.id ?? null,
      hostName: vps?.host || "This computer",
      discoveryError: tree.error || sources.error || null,
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

    if (body.hostId !== undefined && body.hostId !== (vps?.id ?? null)) {
      return NextResponse.json({ error: "The active connection changed. Refresh before continuing." }, { status: 409 });
    }
    if (action === "launch_local") return NextResponse.json({ deployment: await launchLocalProject(body, vps) }, { status: 201 });
    if (action === "browse_folders") {
      return NextResponse.json(await browseProjectFolders(body.sourcePath, vps, body.showHidden === true));
    }
    if (action === "inspect_folder") {
      return NextResponse.json(await scanSourceFolder(body.sourcePath, vps));
    }
    if (action === "add_source" || action === "enroll" && body.kind === "source") {
      return NextResponse.json(await addSourceProject(body.sourcePath, vps, body.projectId ? Number(body.projectId) : null, body.name, body.description), { status: 201 });
    }
    if (action === "dismiss" || action === "restore") {
      await setSuggestionHidden(vps?.id ?? null, String(body.candidateId || ""), action === "dismiss");
      return NextResponse.json({ ok: true });
    }
    if (action === "restore_all") {
      await prisma.appConfig.deleteMany({ where: { key: { startsWith: dismissalPrefix(vps?.id ?? null) } } });
      return NextResponse.json({ ok: true });
    }

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
      const current = await prisma.enrolledDeployment.findFirst({ where: { id: deploymentId, vpsConfigId: vps?.id ?? null } });
      if (!current) return NextResponse.json({ error: "Deployment not found on this connection" }, { status: 404 });
      const deployment = await prisma.enrolledDeployment.update({
        where: { id: deploymentId },
        data: { projectGroupId: projectId },
        include: { projectGroup: true },
      });
      return NextResponse.json({ deployment });
    }

    if (action === "unenroll") {
      const item = await prisma.enrolledDeployment.findFirst({ where: { id: Number(body.deploymentId || 0), vpsConfigId: vps?.id ?? null } });
      if (!item) return NextResponse.json({ error: "Deployment not found on this connection" }, { status: 404 });
      // Keep the legacy project/history, but prevent reconciliation from re-adding it.
      await setSuggestionHidden(vps?.id ?? null, candidateIdentity(item), true);
      await prisma.$transaction(async (tx) => {
        if (item.legacyProjectId) {
          const key = untrackedProjectKey(vps?.id ?? null, item.legacyProjectId);
          const value = String(item.legacyProjectId);
          await tx.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
        }
        await tx.enrolledDeployment.delete({ where: { id: item.id } });
      });
      return NextResponse.json({ ok: true });
    }

    if (action !== "enroll") return NextResponse.json({ error: "Unsupported action" }, { status: 400 });

    const deployment = await connectExistingDeployment(body, vps);
    return NextResponse.json({ deployment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
