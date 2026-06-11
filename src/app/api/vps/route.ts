import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptIfNeeded } from "@/lib/crypto";

/**
 * Strip secrets from a VpsConfig row before sending it to the client.
 * The client never receives privateKey/password — only booleans telling it
 * whether one is configured.
 */
function sanitize(config: any) {
  const { privateKey, password, ...rest } = config;
  return {
    ...rest,
    hasKey: !!privateKey,
    hasPassword: !!password,
  };
}

export async function GET() {
  const configs = await prisma.vpsConfig.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json(configs.map(sanitize));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const config = await prisma.vpsConfig.create({
    data: {
      name: body.name || "primary",
      host: body.host,
      port: body.port || 22,
      username: body.username || "root",
      // Secrets are encrypted at rest before they touch the DB.
      privateKey: encryptIfNeeded(body.privateKey || null) ?? null,
      password: encryptIfNeeded(body.password || null) ?? null,
      authType: body.authType || "key",
      isLocal: body.isLocal || false,
    },
  });
  return NextResponse.json(sanitize(config));
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();

  // Only overwrite secret fields when a new value is explicitly supplied,
  // so editing other fields doesn't wipe an existing key/password.
  const data: any = {
    name: body.name,
    host: body.host,
    port: body.port,
    username: body.username,
    authType: body.authType,
    isLocal: body.isLocal,
  };
  if (body.privateKey !== undefined && body.privateKey !== null && body.privateKey !== "") {
    data.privateKey = encryptIfNeeded(body.privateKey);
  }
  if (body.password !== undefined && body.password !== null && body.password !== "") {
    data.password = encryptIfNeeded(body.password);
  }

  const config = await prisma.vpsConfig.update({
    where: { id: body.id },
    data,
  });
  return NextResponse.json(sanitize(config));
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") || "0");
  await prisma.vpsConfig.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
