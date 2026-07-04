import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { decryptInfisicalCredentials, testInfisicalProvider } from "@/lib/infisical";

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const provider = String(body.provider || "infisical");
    if (provider === "local") return NextResponse.json({ ok: true, count: 0 });

    let config = body.config || {};
    let credentials = body.credentials || {};
    if (body.providerId) {
      const account = await prisma.envProviderAccount.findUnique({ where: { id: Number(body.providerId) } });
      if (!account) return NextResponse.json({ ok: false, error: "Provider not found" }, { status: 404 });
      config = JSON.parse(account.configJson || "{}");
      credentials = decryptInfisicalCredentials(account.credentials);
    }
    const result = await testInfisicalProvider(config, credentials);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
