import { NextResponse } from "next/server";
import { scanProjects, getSystemConfig, getSystemdServices } from "@/lib/vps";
import { parseComposeServices, scanProjectsTree, type ScannedProject } from "@/lib/project-scan";
import { prisma } from "@/lib/prisma";

function normalizeRoot(root: string): string {
  return (root || "").replace(/\/+$/, "");
}

function deriveName(slug: string): string {
  return slug
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || slug;
}

function synthesizeProjectFromRecord(
  project: Awaited<ReturnType<typeof prisma.project.findMany>>[number],
  templateDeploymentRoot: string
): ScannedProject | null {
  if (!project.path) return null;
  const path = normalizeRoot(project.path);
  const managedRoot = normalizeRoot(templateDeploymentRoot || "/srv/groundcontrol/deployments");
  const managed = path === managedRoot || path.startsWith(`${managedRoot}/`);
  const rel = managed ? path.slice(managedRoot.length).replace(/^\/+/, "") : project.slug;
  const parts = rel.split("/").filter(Boolean);
  const dirName = parts[parts.length - 1] || project.slug;
  const parent = parts.length > 1 ? parts[parts.length - 2] : null;
  const parsed = parseComposeServices(project.dockerCompose || "");

  return {
    slug: project.slug,
    dirName,
    name: project.name || deriveName(project.slug),
    path,
    composePath: `${path}/docker-compose.yml`,
    parent,
    services: parsed.services,
    domain: parsed.domain || project.domain || undefined,
    hasGit: Boolean(project.repoUrl),
    valid: parsed.valid,
    parseError: parsed.error,
    managed,
  };
}

export async function GET() {
  try {
    const [scan, tree, services, dbProjects, systemConfig] = await Promise.all([
      scanProjects(),
      scanProjectsTree(),
      getSystemdServices(),
      prisma.project.findMany(),
      getSystemConfig(),
    ]);
    const scannedByPath = new Set(tree.projects.map((project) => normalizeRoot(project.path)));
    const scannedBySlug = new Set(tree.projects.map((project) => project.slug));
    const synthesized = dbProjects.flatMap((project) => {
      const item = synthesizeProjectFromRecord(project, systemConfig.templateDeploymentRoot);
      if (!item) return [];
      if (scannedByPath.has(normalizeRoot(item.path)) || scannedBySlug.has(item.slug)) return [];
      return [item];
    });
    const scannedProjects = [...tree.projects, ...synthesized].sort((a, b) => {
      if (a.managed !== b.managed) return a.managed ? -1 : 1;
      return a.slug.localeCompare(b.slug);
    });

    return NextResponse.json({
      // Legacy top-level dir listing (kept for backwards compat / caddy view).
      directories: scan.optDirs,
      caddySites: scan.caddySites,
      // New recursive, compose-keyed project list.
      scannedProjects,
      plainDirs: tree.plainDirs,
      scanError: tree.error || null,
      services: services.slice(0, 50),
      projects: dbProjects,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load projects" }, { status: 500 });
  }
}
