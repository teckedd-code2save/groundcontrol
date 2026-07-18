import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  buildGithubAppManifest,
  createGithubManifestState,
  normalizeGithubPublicUrl,
} from "@/lib/github-app";

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") throw new HttpError("Admin access required", 403);
    const existing = await prisma.githubAppConnection.findFirst({ select: { id: true } });
    if (existing) throw new HttpError("Disconnect the current GitHub App before creating another one.", 409);

    const body = await req.json().catch(() => ({}));
    const publicUrl = normalizeGithubPublicUrl(String(body.publicUrl || process.env.GC_PUBLIC_URL || ""));
    const state = createGithubManifestState({ userId: user.id, publicUrl });
    const manifest = buildGithubAppManifest(publicUrl);
    return NextResponse.json({
      action: `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`,
      manifest: JSON.stringify(manifest),
      expiresInSeconds: 600,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
