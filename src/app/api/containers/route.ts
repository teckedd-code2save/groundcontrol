import { NextRequest, NextResponse } from "next/server";
import { getDockerContainers, getDockerStats, getDockerContainerLabels } from "@/lib/vps";
import { controlContainerWithState, type ContainerAction } from "@/lib/container-control";

const VALID_ACTIONS: ContainerAction[] = ["start", "stop", "restart", "remove"];

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
      composeWorkingDir: labelsMap.get(c.name)?.workingDir || "",
      composeConfigFiles: labelsMap.get(c.name)?.configFiles || "",
      projectSlug: labelsMap.get(c.name)?.projectSlug || labelsMap.get(c.name)?.project || "",
    }));

    return NextResponse.json(merged);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action, name } = await req.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Container name required" }, { status: 400 });
    }
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action "${action}". Expected one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Run the action then read back the real, fresh container state so the
    // client can flip the badge to running/stopped without guessing.
    const result = await controlContainerWithState(action as ContainerAction, name);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
