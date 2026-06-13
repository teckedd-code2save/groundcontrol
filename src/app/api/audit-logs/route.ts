import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") {
      // Non-admin users can only see their own logs
      const logs = await prisma.auditLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { user: { select: { username: true } } },
      });
      return NextResponse.json({ logs });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const userIdParam = searchParams.get("userId");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);

    const logs = await prisma.auditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(userIdParam ? { userId: parseInt(userIdParam, 10) } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { username: true } } },
    });

    return NextResponse.json({ logs });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
