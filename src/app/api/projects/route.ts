import { NextResponse } from "next/server";
import { scanProjects, getSystemdServices } from "@/lib/vps";
import { scanProjectsTree } from "@/lib/project-scan";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const [scan, tree, services, dbProjects] = await Promise.all([
      scanProjects(),
      scanProjectsTree(),
      getSystemdServices(),
      prisma.project.findMany(),
    ]);

    return NextResponse.json({
      // Legacy top-level dir listing (kept for backwards compat / caddy view).
      directories: scan.optDirs,
      caddySites: scan.caddySites,
      // New recursive, compose-keyed project list.
      scannedProjects: tree.projects,
      plainDirs: tree.plainDirs,
      scanError: tree.error || null,
      services: services.slice(0, 50),
      projects: dbProjects,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
