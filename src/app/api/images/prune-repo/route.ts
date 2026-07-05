import { NextRequest, NextResponse } from "next/server";
import { planRepositoryImagePrune } from "@/lib/image-prune";
import { execOnVps, shQuote } from "@/lib/vps";

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
      const [name, imageId, imageRef, running] = line.split("|");
      return {
        name: name.replace(/^\//, ""),
        imageId,
        imageRef,
        state: running === "true" ? "running" : "stopped",
      };
    });
}

async function buildPlan(repository: string, includeStopped = false) {
  const imagesResult = await execOnVps(
    `docker images --format "{{.Repository}}|{{.Tag}}|{{.ID}}|{{.Size}}|{{.CreatedAt}}"`
  );
  const usageResult = await execOnVps(
    `docker ps -a -q | xargs -r docker inspect --format '{{.Name}}|{{.Image}}|{{.Config.Image}}|{{.State.Running}}'`
  );
  return planRepositoryImagePrune({
    repository,
    includeStopped,
    images: parseImages(imagesResult.stdout),
    usages: parseUsages(usageResult.stdout),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { repository, preview, includeStopped } = await req.json();
    if (!repository) {
      return NextResponse.json({ error: "repository required" }, { status: 400 });
    }

    const plan = await buildPlan(repository, !!includeStopped);
    if (preview) return NextResponse.json({ success: true, plan });

    const removed: string[] = [];
    const errors: string[] = [];

    for (const img of plan.removable) {
      const rmi = await execOnVps(`docker rmi ${shQuote(img.id)} 2>&1`);
      if (rmi.code === 0) {
        removed.push(img.fullName);
      } else {
        errors.push(`${img.fullName}: ${rmi.stderr || rmi.stdout}`);
      }
    }

    return NextResponse.json({
      success: true,
      plan,
      removed,
      errors: errors.length > 0 ? errors : undefined,
      kept: plan.kept.map((img) => img.fullName),
      protected: plan.protected.map((img) => img.fullName),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
