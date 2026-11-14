import { requireCandidateConfigOwner } from "@/lib/candidate-config-access";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { materializeEnvBundle, resolveDeploymentEnv } from "@/lib/env-management";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req);
    const { id } = await params;
    const profile = await prisma.deploymentEnvProfile.findUnique({
      where: { id: Number(id) },
      include: { project: true },
    });
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const candidate = await requireCandidateConfigOwner(user.id, profile.projectId, profile.id);
    if (candidate) return NextResponse.json({ error: "Candidate configuration is materialized only by its scoped, owner-approved deployment operation; active-server materialization is disabled." }, { status: 409 });
    const resolved = await resolveDeploymentEnv(profile.project, profile.slug);
    if (!resolved) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    if (!resolved.validation.ok) {
      return NextResponse.json({ error: `Missing required env keys: ${resolved.validation.missing.join(", ")}`, validation: resolved.validation }, { status: 400 });
    }
    const result = await materializeEnvBundle(
      profile.project.path,
      resolved.values,
      resolved.componentValues,
      undefined,
      {
        environmentSlug: profile.slug,
        rootPruneKeys: resolved.removedValues,
        componentPruneKeys: resolved.removedComponentValues,
      }
    );
    const updated = await prisma.deploymentEnvProfile.update({
      where: { id: profile.id },
      data: {
        status: "synced",
        lastHash: resolved.validation.hash,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });
    return NextResponse.json({ profile: updated, validation: resolved.validation, result });
  } catch (err) {
    return handleApiError(err);
  }
}
