import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAuth(req);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    await prisma.projectSource.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) { return handleApiError(error); }
}
