import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  encryptCloudCredentials,
  serializeCloudProviderAccount,
} from "@/lib/cloud/accounts";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

function isValidProvider(provider: string): boolean {
  return ["gcp", "aws", "azure"].includes(provider.toLowerCase());
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const accounts = await prisma.cloudProviderAccount.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(accounts.map(serializeCloudProviderAccount));
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json();
    const { name, provider, credentials, isActive } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Account name is required" }, { status: 400 });
    }
    if (!provider || typeof provider !== "string" || !isValidProvider(provider)) {
      return NextResponse.json(
        { error: "Provider must be one of: gcp, aws, azure" },
        { status: 400 }
      );
    }
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      return NextResponse.json({ error: "Credentials must be a JSON object" }, { status: 400 });
    }

    const account = await prisma.cloudProviderAccount.create({
      data: {
        name,
        provider: provider.toLowerCase(),
        credentials: encryptCloudCredentials(credentials as Record<string, unknown>),
        isActive: isActive === true,
      },
    });

    if (account.isActive) {
      await prisma.cloudProviderAccount.updateMany({
        where: { id: { not: account.id }, provider: provider.toLowerCase(), isActive: true },
        data: { isActive: false },
      });
    }

    return NextResponse.json(serializeCloudProviderAccount(account), { status: 201 });
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
