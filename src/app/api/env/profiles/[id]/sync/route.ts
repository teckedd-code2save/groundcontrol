import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { resolveDeploymentEnv } from "@/lib/env-management";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAuth(req);
    const { id } = await params;
    const profile = await prisma.deploymentEnvProfile.findUnique({
      where: { id: Number(id) },
      include: { project: true },
    });
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const resolved = await resolveDeploymentEnv(profile.project);
    if (!resolved) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const updated = await prisma.deploymentEnvProfile.update({
      where: { id: profile.id },
      data: {
        status: resolved.validation.ok ? "synced" : "missing",
        lastHash: resolved.validation.hash,
        lastSyncedAt: new Date(),
        lastError: resolved.validation.ok ? null : `Missing: ${resolved.validation.missing.join(", ")}`,
      },
    });
    return NextResponse.json({
      profile: updated,
      validation: resolved.validation,
      count: Object.keys(resolved.values).length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
