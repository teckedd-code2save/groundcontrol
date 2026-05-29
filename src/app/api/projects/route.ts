import { NextResponse } from "next/server";
import { scanProjects, getSystemdServices } from "@/lib/vps";

export async function GET() {
  try {
    const [scan, services] = await Promise.all([
      scanProjects(),
      getSystemdServices(),
    ]);

    return NextResponse.json({
      directories: scan.optDirs,
      caddySites: scan.caddySites,
      services: services.slice(0, 50),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
