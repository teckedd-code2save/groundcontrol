import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const tunnels = await (prisma as any).cloudflareTunnel.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ tunnels: tunnels.map((t: any) => ({
      ...t,
      token: t.token.slice(0, 12) + "...",
    })) });
  } catch {
    // Table might not exist yet — return empty
    return NextResponse.json({ tunnels: [] });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const { name, token } = await req.json();
    if (!name || !token) {
      return NextResponse.json({ error: "name and token are required" }, { status: 400 });
    }

    const tunnel = await (prisma as any).cloudflareTunnel.create({
      data: { name, token },
    });
    return NextResponse.json({ success: true, tunnel: { ...tunnel, token: tunnel.token.slice(0, 12) + "..." } });
  } catch (err) {
    return NextResponse.json({ error: "Could not save tunnel. Run: npx prisma db push" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const { id } = await req.json();
    await (prisma as any).cloudflareTunnel.delete({ where: { id: parseInt(id) } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Could not delete tunnel" }, { status: 500 });
  }
}
