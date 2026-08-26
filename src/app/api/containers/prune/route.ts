import { NextRequest, NextResponse } from "next/server";
import { planDockerCleanup } from "@/lib/image-prune";
import { execOnVps, shQuote } from "@/lib/vps";
import { requireAuth } from "@/lib/auth";

function parseImages(stdout: string) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [repository, tag, id, size, createdAt] = line.split("|");
      return { repository, tag, id, size, createdAt };
    });
}

function parseUsages(stdout: string) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, imageId, imageRef, running, composeProject, composeService] = line.split("|");
      return {
        name: name.replace(/^\//, ""),
        imageId,
        imageRef,
        state: running === "true" ? "running" : "stopped",
        composeProject,
        composeService,
      };
    });
}

function parseContainers(stdout: string) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, id, image, state, status, composeProject, composeService] = line.split("|");
      return { name, id, image, state, status, composeProject, composeService };
    });
}

function parseBuildCache(stdout: string): string | undefined {
  const row = stdout
    .trim()
    .split("\n")
    .find((line) => line.toLowerCase().startsWith("build cache|"));
  return row?.split("|")[4]?.trim();
}

async function buildCleanupPlan(options: {
  includeStoppedContainerImages?: boolean;
  includeStoppedContainers?: boolean;
}) {
  const [imagesResult, usageResult, containerResult, diskResult] = await Promise.all([
    execOnVps(`docker images --format "{{.Repository}}|{{.Tag}}|{{.ID}}|{{.Size}}|{{.CreatedAt}}"`),
    execOnVps(
      `docker ps -a -q | xargs -r docker inspect --format '{{.Name}}|{{.Image}}|{{.Config.Image}}|{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}'`
    ),
    execOnVps(
      `docker ps -a --format "{{.Names}}|{{.ID}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Label \\"com.docker.compose.project\\"}}|{{.Label \\"com.docker.compose.service\\"}}"`
    ),
    execOnVps(`docker system df --format "{{.Type}}|{{.TotalCount}}|{{.Active}}|{{.Size}}|{{.Reclaimable}}" 2>/dev/null || true`),
  ]);

  return planDockerCleanup({
    images: parseImages(imagesResult.stdout),
    usages: parseUsages(usageResult.stdout),
    containers: parseContainers(containerResult.stdout),
    includeStoppedContainerImages: options.includeStoppedContainerImages,
    includeStoppedContainers: options.includeStoppedContainers,
    buildCacheReclaimable: parseBuildCache(diskResult.stdout),
  });
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const plan = await buildCleanupPlan({
      includeStoppedContainerImages: !!body.includeStoppedContainerImages,
      includeStoppedContainers: !!body.includeStoppedContainers,
    });

    if (body.preview) {
      return NextResponse.json({ success: true, plan });
    }

    const removedContainers: string[] = [];
    const removedImages: string[] = [];
    const errors: string[] = [];

    for (const container of plan.containers.removable) {
      const rm = await execOnVps(`docker rm ${shQuote(container.id)} 2>&1`);
      if (rm.code === 0) removedContainers.push(container.name);
      else errors.push(`${container.name}: ${rm.stderr || rm.stdout}`);
    }

    for (const image of plan.images.removable) {
      const rmi = await execOnVps(`docker rmi ${shQuote(image.id)} 2>&1`);
      if (rmi.code === 0) removedImages.push(image.fullName);
      else errors.push(`${image.fullName}: ${rmi.stderr || rmi.stdout}`);
    }

    const builder = body.pruneBuildCache === false
      ? { code: 0, stdout: "", stderr: "" }
      : await execOnVps(`docker builder prune -af 2>&1`);
    if (builder.code !== 0) errors.push(`build cache: ${builder.stderr || builder.stdout}`);

    return NextResponse.json({
      success: errors.length === 0,
      plan,
      removedContainers,
      removedImages,
      buildCache: body.pruneBuildCache === false ? "skipped" : builder.stdout.trim(),
      errors: errors.length > 0 ? errors : undefined,
      output: [
        `${removedContainers.length} stopped container${removedContainers.length === 1 ? "" : "s"} removed`,
        `${removedImages.length} image${removedImages.length === 1 ? "" : "s"} removed`,
        body.pruneBuildCache === false ? "build cache skipped" : "build cache cleaned",
      ].join("; "),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
