import { NextRequest, NextResponse } from "next/server";
import { getDockerContainers, getDockerStats, getDockerContainerLabels, controlContainer } from "@/lib/vps";

export async function GET() {
  try {
    const [containers, stats, labels] = await Promise.all([
      getDockerContainers(),
      getDockerStats(),
      getDockerContainerLabels(),
    ]);

    const statsMap = new Map(stats.map((s) => [s.name, s]));
    const labelsMap = new Map(labels.map((l) => [l.name, l]));

    const merged = containers.map((c) => ({
      ...c,
      stats: statsMap.get(c.name) || null,
      composeProject: labelsMap.get(c.name)?.project || "",
      composeService: labelsMap.get(c.name)?.service || "",
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
