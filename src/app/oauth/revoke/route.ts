import { NextRequest, NextResponse } from "next/server";
import { hashOpaqueToken } from "@/lib/oauth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const params = new URLSearchParams(await req.text());
  const raw = params.get("token") || "";
  if (raw) {
    const token = await prisma.oAuthToken.findUnique({
      where: { tokenHash: hashOpaqueToken(raw) },
      include: { grant: { include: { client: true } } },
    });
    const clientId = params.get("client_id");
    if (token && (!clientId || token.grant.client.clientId === clientId)) {
      if (token.kind === "refresh") {
        await prisma.oAuthToken.updateMany({
          where: { familyId: token.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } else {
        await prisma.oAuthToken.updateMany({
          where: { id: token.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    }
  }
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
