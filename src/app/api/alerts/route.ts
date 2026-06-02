import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "20");
  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json(alerts);
}

export async function PATCH(req: NextRequest) {
  const { id } = await req.json();
  await prisma.alert.update({
    where: { id },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await prisma.alert.delete({
    where: { id: parseInt(id) },
  });
  return NextResponse.json({ ok: true });
}
