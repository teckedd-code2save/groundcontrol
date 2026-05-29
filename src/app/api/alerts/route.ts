import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
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
