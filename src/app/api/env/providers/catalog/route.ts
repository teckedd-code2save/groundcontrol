import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  decryptInfisicalCredentials,
  listInfisicalProjects,
  type InfisicalProviderConfig,
} from "@/lib/infisical";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const providerAccountId = Number(searchParams.get("providerAccountId") || 0);
    if (!providerAccountId) {
      return NextResponse.json({ error: "providerAccountId is required" }, { status: 400 });
    }
    const provider = await prisma.envProviderAccount.findUnique({ where: { id: providerAccountId } });
    if (!provider || provider.provider !== "infisical") {
      return NextResponse.json({ error: "Infisical provider not found" }, { status: 404 });
    }
    const config = parseConfig<InfisicalProviderConfig>(provider.configJson);
    const projects = await listInfisicalProjects(config, decryptInfisicalCredentials(provider.credentials));
    return NextResponse.json({ projects });
  } catch (error) {
    return handleApiError(error);
  }
}

function parseConfig<T>(value: string): T {
  try {
    return JSON.parse(value || "{}") as T;
  } catch {
    return {} as T;
  }
}
