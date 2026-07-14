import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
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
    const deployment = await prisma.enrolledDeployment.update({
      where: { id: deploymentId },
      data: { projectGroupId },
    });
    return NextResponse.json({ deployment });
  } catch (error) {
    return handleApiError(error);
  }
}
