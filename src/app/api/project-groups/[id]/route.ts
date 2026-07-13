import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAuth(req);
    const { id } = await ctx.params;
    const projectId = Number(id);
    if (!Number.isFinite(projectId)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    const body = await req.json();
    const project = await prisma.projectGroup.update({
      where: { id: projectId },
      data: {
        ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
        ...(typeof body.description === "string" ? { description: body.description.trim() } : {}),
      },
    });
    return NextResponse.json({ project });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAuth(req);
    const { id } = await ctx.params;
    const projectId = Number(id);
    if (!Number.isFinite(projectId)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    await prisma.$transaction([
      prisma.project.updateMany({ where: { projectGroupId: projectId }, data: { projectGroupId: null } }),
      prisma.projectGroup.delete({ where: { id: projectId } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
