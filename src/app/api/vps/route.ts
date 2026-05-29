import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { testConnection, getSystemStats } from "@/lib/vps";

export async function GET() {
  const configs = await prisma.vpsConfig.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json(configs);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const config = await prisma.vpsConfig.create({
    data: {
      name: body.name || "primary",
      host: body.host,
      port: body.port || 22,
      username: body.username || "root",
      privateKey: body.privateKey || null,
      password: body.password || null,
      authType: body.authType || "key",
      isLocal: body.isLocal || false,
    },
  });
  return NextResponse.json(config);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const config = await prisma.vpsConfig.update({
    where: { id: body.id },
    data: {
      name: body.name,
      host: body.host,
      port: body.port,
      username: body.username,
      privateKey: body.privateKey,
      password: body.password,
      authType: body.authType,
      isLocal: body.isLocal,
    },
  });
  return NextResponse.json(config);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") || "0");
  await prisma.vpsConfig.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
