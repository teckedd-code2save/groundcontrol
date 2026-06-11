import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidateSystemConfigCache } from "@/lib/vps";

/**
 * Switch the active VPS. Exactly one VpsConfig is active at a time — all pages
 * target whichever one is active. This is a server you SWITCH BETWEEN, not a
 * separate account.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const target = await prisma.vpsConfig.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "VPS not found" }, { status: 404 });
  }

  // Deactivate everything, then activate the target — atomically.
  await prisma.$transaction([
    prisma.vpsConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    }),
    prisma.vpsConfig.update({
      where: { id },
      data: { isActive: true },
    }),
  ]);

  // Per-VPS system paths change with the active VPS — drop the cache.
  invalidateSystemConfigCache();

  return NextResponse.json({ ok: true, activeId: id });
}
