import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { verifyCloudflareToken, getActiveCloudflareAccount } from "@/lib/cloudflare";
import { prisma } from "@/lib/prisma";
import { decryptMaybe } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = (await req.json()) as Record<string, unknown>;

    let account = await getActiveCloudflareAccount();
    if (body.id) {
      const dbAccount = await prisma.cloudflareAccount.findUnique({ where: { id: Number(body.id) } });
      if (!dbAccount) return NextResponse.json({ error: "Account not found" }, { status: 404 });
      account = { ...dbAccount, apiToken: decryptMaybe(dbAccount.apiToken) || "" };
    }

    if (!account) return NextResponse.json({ error: "No Cloudflare account configured" }, { status: 400 });

    const result = await verifyCloudflareToken({ apiToken: account.apiToken });
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
