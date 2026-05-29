import { NextRequest, NextResponse } from "next/server";
import { getDockerContainers, getDockerStats, controlContainer, getContainerLogs } from "@/lib/vps";

export async function GET() {
  try {
    const [containers, stats] = await Promise.all([
      getDockerContainers(),
      getDockerStats(),
    ]);

    const statsMap = new Map(stats.map((s) => [s.name, s]));
    const merged = containers.map((c) => ({
      ...c,
      stats: statsMap.get(c.name) || null,
    }));

    return NextResponse.json(merged);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action, name } = await req.json();
    const result = await controlContainer(action, name);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
