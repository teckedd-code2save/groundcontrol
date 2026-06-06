import { NextResponse } from "next/server";
import { scanProjects, getSystemdServices } from "@/lib/vps";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const [scan, services, dbProjects] = await Promise.all([
      scanProjects(),
      getSystemdServices(),
      prisma.project.findMany(),
    ]);

    return NextResponse.json({
      directories: scan.optDirs,
      caddySites: scan.caddySites,
      services: services.slice(0, 50),
      projects: dbProjects,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
