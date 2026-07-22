import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getActiveVps, getDockerContainerLabels, getDockerContainers } from "@/lib/vps";
import { scanProjects } from "@/lib/vps";
import { scanProjectsTree } from "@/lib/project-scan";
import { resolveDeploymentEvidence } from "@/lib/deployment-evidence";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    requireAuth(req);
    const { slug } = await ctx.params;
    const vps = await getActiveVps();
    const [deployment, containers, labels, projects, tree, hostProjects] = await Promise.all([
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
      scanProjectsTree(vps),
      scanProjects(vps),
    ]);

    if (!deployment) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }

    const releases = deployment.legacyProject?.deployments || [];
    const latestRelease = releases[0] || null;
    const evidence = resolveDeploymentEvidence({
      ...deployment,
      savedDomain: deployment.legacyProject?.domain,
      savedRepoUrl: deployment.legacyProject?.repoUrl,
    }, containers, labels, tree.projects, hostProjects.caddySites);
    const runtimeNames = new Set(evidence.runtime.containers.map((container) => container.name));
    const runtimeComposePath = labels
      .find((label) => runtimeNames.has(label.name) && label.configFiles)?.configFiles
      .split(",")
      .map((file) => file.trim())
      .find((file) => file.startsWith("/")) || null;
    const runtimeEvents = await prisma.deploymentLog.findMany({
      where: {
        projectSlug: { in: Array.from(new Set([
          deployment.slug,
          deployment.legacyProject?.slug,
          evidence.runtime.composeProject,
        ].filter((value): value is string => Boolean(value)))) },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({
      deployment: {
        ...deployment,
        composePath: runtimeComposePath || deployment.composePath,
        project: deployment.projectGroup,
        projectId: deployment.projectGroupId,
        legacyProjectSlug: deployment.legacyProject?.slug || null,
        repoUrl: evidence.repoUrl,
        domain: deployment.legacyProject?.domain || null,
        publicUrl: evidence.publicUrl || latestRelease?.publicUrl || latestRelease?.previewUrl || null,
        runtime: evidence.runtime,
        route: evidence.route,
        identitySource: evidence.identitySource,
        runtimeEvents,
        releases,
        envProfile: deployment.legacyProject?.envProfiles[0] || null,
        observedStatus: evidence.runtime.status === "present" || evidence.route || deployment.kind === "static" && Boolean(deployment.legacyProject)
          ? "present" : "missing",
      },
      projects,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function parsePublicUrl(value: unknown): { url: string | null; domain: string | null; error?: string } {
  const text = String(value || "").trim();
  if (!text) return { url: null, domain: null };
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!url.hostname || !["http:", "https:"].includes(url.protocol)) throw new Error();
    return { url: url.toString().replace(/\/$/, ""), domain: url.hostname };
  } catch {
    return { url: null, domain: null, error: "Enter a valid public HTTP or HTTPS URL." };
  }
}

function parseGithubUrl(value: unknown): { url: string | null; error?: string } {
  const text = String(value || "").trim().replace(/\.git$/, "");
  if (!text) return { url: null };
  const ssh = text.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
  const normalized = ssh ? `https://github.com/${ssh[1]}` : text;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.pathname.split("/").filter(Boolean).length < 2) throw new Error();
    return { url: `${url.origin}/${url.pathname.split("/").filter(Boolean).slice(0, 2).join("/")}` };
  } catch {
    return { url: null, error: "Enter a valid GitHub repository URL." };
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    requireAuth(req);
    const { slug } = await ctx.params;
    const body = await req.json();
    const publicIdentity = parsePublicUrl(body.publicUrl);
    const repository = parseGithubUrl(body.repoUrl);
    if (publicIdentity.error || repository.error) {
      return NextResponse.json({ error: publicIdentity.error || repository.error }, { status: 400 });
    }
    const deployment = await prisma.enrolledDeployment.findUnique({ where: { slug }, include: { legacyProject: true } });
    if (!deployment) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(deployment.metadataJson || "{}"); } catch {}
    metadata.manualPublicUrl = publicIdentity.url;
    metadata.manualRepoUrl = repository.url;
    metadata.identityUpdatedAt = new Date().toISOString();

    let legacyProjectId = deployment.legacyProjectId;
    if (deployment.legacyProject) {
      await prisma.project.update({
        where: { id: deployment.legacyProject.id },
        data: { domain: publicIdentity.domain, repoUrl: repository.url },
      });
    } else {
      const project = await prisma.project.create({
        data: {
          slug: deployment.slug,
          name: deployment.name,
          path: deployment.sourcePath || "",
          domain: publicIdentity.domain,
          repoUrl: repository.url,
          category: deployment.kind === "compose" ? "docker" : deployment.kind,
          status: deployment.status,
        },
      });
      legacyProjectId = project.id;
    }
    await prisma.enrolledDeployment.update({
      where: { id: deployment.id },
      data: { metadataJson: JSON.stringify(metadata), legacyProjectId },
    });
    return NextResponse.json({ success: true, publicUrl: publicIdentity.url, repoUrl: repository.url });
  } catch (error) {
    return handleApiError(error);
  }
}
