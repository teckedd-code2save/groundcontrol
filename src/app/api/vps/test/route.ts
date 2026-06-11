import { NextRequest, NextResponse } from "next/server";
import { testConnection } from "@/lib/vps";
import { prisma } from "@/lib/prisma";
import { decryptMaybe } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const body = await req.json();

  // If the request only references a saved connection (by id) without supplying
  // fresh secrets, load and decrypt the stored credentials server-side so we can
  // test without ever sending the secret back to the client.
  if (body.id && !body.privateKey && !body.password) {
    const saved = await prisma.vpsConfig.findUnique({ where: { id: Number(body.id) } });
    if (!saved) {
      return NextResponse.json({ success: false, message: "Saved VPS not found" });
    }
    const result = await testConnection({
      host: saved.host,
      port: saved.port,
      username: saved.username,
      privateKey: decryptMaybe(saved.privateKey) || undefined,
      password: decryptMaybe(saved.password) || undefined,
      authType: saved.authType,
      isLocal: saved.isLocal,
    });
    return NextResponse.json(result);
  }

  const result = await testConnection(body);
  return NextResponse.json(result);
}
