import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { encryptInfisicalCredentials, ensureLocalEnvProvider } from "@/lib/env-management";

function sanitizeProvider(provider: {
  id: number;
  name: string;
  provider: string;
  configJson: string;
  credentials: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...provider,
    credentials: undefined,
    hasCredentials: Boolean(provider.credentials),
  };
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    await ensureLocalEnvProvider();
    const providers = await prisma.envProviderAccount.findMany({
      orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
    });
    return NextResponse.json({ providers: providers.map(sanitizeProvider) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const provider = String(body.provider || "local");
    const configJson = JSON.stringify(body.config || {});
    const credentials = provider === "infisical"
      ? encryptInfisicalCredentials({
          clientId: body.credentials?.clientId || body.clientId || "",
          clientSecret: body.credentials?.clientSecret || body.clientSecret || "",
        })
      : "";
    const data = {
      name: String(body.name || (provider === "infisical" ? "Infisical" : "Local encrypted .env")),
      provider,
      configJson,
      credentials,
      isActive: body.isActive !== false,
    };
    const saved = body.id
      ? await prisma.envProviderAccount.update({ where: { id: Number(body.id) }, data })
      : await prisma.envProviderAccount.create({ data });
    return NextResponse.json({ provider: sanitizeProvider(saved) });
  } catch (err) {
    return handleApiError(err);
  }
}
