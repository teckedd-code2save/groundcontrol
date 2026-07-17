import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { setLocalEnvValues } from "@/lib/env-management";

/**
 * POST /api/sync/image-tag
 *
 * Called by CI pipeline after pushing a new image to ghcr.
 * Updates the deployment env values so the next redeploy picks up
 * the new image tag automatically.
 *
 * Body:
 *   deploymentSlug: string   — "rentaweekend" or "groundcontrol"
 *   images: Record<string, string> — { "API_IMAGE": "ghcr.io/...:sha", "WEB_IMAGE": "ghcr.io/...:sha" }
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("x-pipeline-token") || "";
    const expected = process.env.PIPELINE_SYNC_TOKEN;
    if (!expected || token !== expected) {
      const user = requireAuth(req);
      if (user.role !== "admin") {
        return NextResponse.json({ error: "Admin access or pipeline token required" }, { status: 403 });
      }
    }

    const body = await req.json().catch(() => ({})) as {
      deploymentSlug?: string;
      images?: Record<string, string>;
    };

    const { deploymentSlug, images } = body;
    if (!deploymentSlug || !images || Object.keys(images).length === 0) {
      return NextResponse.json(
        { error: "deploymentSlug and images (map of key→image_ref) are required" },
        { status: 400 }
      );
    }

    // Find the project by slug
    const project = await prisma.project.findFirst({
      where: { slug: deploymentSlug },
    });
    if (!project) {
      return NextResponse.json({ error: `Project not found: ${deploymentSlug}` }, { status: 404 });
    }

    // Find the default env profile
    const profile = await prisma.deploymentEnvProfile.findFirst({
      where: { projectId: project.id },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    if (!profile) {
      return NextResponse.json({ error: "No environment profile found for this deployment" }, { status: 404 });
    }

    // Write image tags as deployment-wide values (component: "")
    // so they land in .env for Docker Compose substitution.
    await setLocalEnvValues(profile.id, images, [], "");

    return NextResponse.json({
      ok: true,
      updated: Object.keys(images),
      profileId: profile.id,
      note: "Image tags updated. Run redeploy to apply.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
