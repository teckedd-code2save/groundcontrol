import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  encryptCloudCredentials,
  serializeCloudProviderAccount,
} from "@/lib/cloud/accounts";
import { handleApiError } from "@/lib/errors";

function isValidProvider(provider: string): boolean {
  return ["gcp", "aws", "azure"].includes(provider.toLowerCase());
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(req);

    const { id } = await params;
    const accountId = parseInt(id, 10);
    if (!Number.isFinite(accountId)) {
      return NextResponse.json({ error: "Invalid account id" }, { status: 400 });
    }

    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.provider !== undefined) {
      if (typeof body.provider !== "string" || !isValidProvider(body.provider)) {
        return NextResponse.json(
          { error: "Provider must be one of: gcp, aws, azure" },
          { status: 400 }
        );
      }
      data.provider = body.provider.toLowerCase();
    }
    if (body.credentials !== undefined) {
      if (!body.credentials || typeof body.credentials !== "object" || Array.isArray(body.credentials)) {
        return NextResponse.json({ error: "Credentials must be a JSON object" }, { status: 400 });
      }
      data.credentials = encryptCloudCredentials(body.credentials as Record<string, unknown>);
    }
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const account = await prisma.cloudProviderAccount.update({
      where: { id: accountId },
      data,
    });

    if (account.isActive) {
      await prisma.cloudProviderAccount.updateMany({
        where: {
          id: { not: account.id },
          provider: account.provider,
          isActive: true,
        },
        data: { isActive: false },
      });
    }

    return NextResponse.json(serializeCloudProviderAccount(account));
  } catch (err: unknown) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(req);

    const { id } = await params;
    const accountId = parseInt(id, 10);
    if (!Number.isFinite(accountId)) {
      return NextResponse.json({ error: "Invalid account id" }, { status: 400 });
    }

    await prisma.cloudProviderAccount.delete({ where: { id: accountId } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
