import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req);

    const { id } = await params;
    const targetId = parseInt(id, 10);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "Invalid target id" }, { status: 400 });
    }

    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.type !== undefined) data.type = body.type;
    if (body.vpsConfigId !== undefined) data.vpsConfigId = body.vpsConfigId ?? null;
    if (body.configJson !== undefined) data.configJson = String(body.configJson);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const target = await prisma.deploymentTarget.update({
      where: { id: targetId },
      data,
      include: { vps: { select: { id: true, name: true, host: true } } },
    });

    return NextResponse.json(target);
  } catch (err: unknown) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req);

    const { id } = await params;
    const targetId = parseInt(id, 10);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "Invalid target id" }, { status: 400 });
    }

    await prisma.deploymentTarget.delete({ where: { id: targetId } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
