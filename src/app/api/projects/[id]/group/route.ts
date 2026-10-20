import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deploymentEnvironment } from "@/lib/project-deployments";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAuth(req);
    const { id } = await ctx.params;
    const deploymentId = Number(id);
    if (!Number.isFinite(deploymentId)) return NextResponse.json({ error: "Invalid deployment id" }, { status: 400 });
    const body = await req.json();
    const projectGroupId = body.projectGroupId === null || body.projectGroupId === ""
      ? null
      : Number(body.projectGroupId);
    if (projectGroupId !== null && !Number.isFinite(projectGroupId)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }
    const current = await prisma.enrolledDeployment.findUnique({ where: { id: deploymentId } });
    if (!current || current.kind === "source") return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    if (projectGroupId && !await prisma.projectGroup.findUnique({ where: { id: projectGroupId } })) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const environmentName = body.environmentName === undefined ? current.environmentName : deploymentEnvironment(body.environmentName);
    const deployment = await prisma.$transaction(async (tx) => {
      if (current.legacyProjectId) await tx.project.update({ where: { id: current.legacyProjectId }, data: { projectGroupId } });
      return tx.enrolledDeployment.update({ where: { id: deploymentId }, data: { projectGroupId, environmentName } });
    });
    return NextResponse.json({ deployment });
  } catch (error) {
    return handleApiError(error);
  }
}
