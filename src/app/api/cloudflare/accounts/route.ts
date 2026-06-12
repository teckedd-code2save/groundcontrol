import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfNeeded, decryptMaybe } from "@/lib/crypto";
import { maskToken } from "@/lib/cloudflare";

type CloudflareAccountRow = {
  id: number;
  name: string;
  apiToken: string;
  accountId: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function serializeAccount(account: CloudflareAccountRow) {
  return {
    ...account,
    apiToken: maskToken(decryptMaybe(account.apiToken) || ""),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const accounts = await prisma.cloudflareAccount.findMany({ orderBy: { updatedAt: "desc" } });
    return NextResponse.json(accounts.map(serializeAccount));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json();
    const { id, name, apiToken, accountId, email, isActive } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Account name is required" }, { status: 400 });
    }

    const data: Record<string, unknown> = {
      name,
      accountId: accountId || null,
      email: email || null,
      isActive: isActive === true,
    };

    // Only update the token when a new value is supplied (masked values are ignored).
    if (apiToken && typeof apiToken === "string" && !apiToken.includes("•")) {
      data.apiToken = encryptIfNeeded(apiToken);
    }

    let account: CloudflareAccountRow;
    if (id) {
      account = await prisma.cloudflareAccount.update({ where: { id: Number(id) }, data });
    } else {
      if (!apiToken || typeof apiToken !== "string") {
        return NextResponse.json({ error: "API token is required" }, { status: 400 });
      }
      data.apiToken = encryptIfNeeded(apiToken);
      account = await prisma.cloudflareAccount.create({ data: data as never });
    }

    // Ensure only one account is active.
    if (account.isActive) {
      await prisma.cloudflareAccount.updateMany({
        where: { id: { not: account.id }, isActive: true },
        data: { isActive: false },
      });
    }

    return NextResponse.json(serializeAccount(account));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAuth(req);
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Account id required" }, { status: 400 });
    }
    await prisma.cloudflareAccount.delete({ where: { id: Number(id) } });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
