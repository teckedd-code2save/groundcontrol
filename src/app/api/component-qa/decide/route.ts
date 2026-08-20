import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json()) as {
      checkId?: number;
      action?: "approve" | "discard";
    };
    const checkId = Number(body.checkId);
    if (!Number.isInteger(checkId) || checkId <= 0) {
      return NextResponse.json({ error: "checkId is required" }, { status: 400 });
    }

    const existing = await prisma.componentQACheck.findUnique({ where: { id: checkId } });
    if (!existing) return NextResponse.json({ error: "QA check not found" }, { status: 404 });

    if (body.action === "approve") {
      const updated = await prisma.componentQACheck.update({
        where: { id: checkId },
        data: { status: "active" },
      });
      return NextResponse.json({ check: updated });
    }

    if (body.action === "discard") {
      await prisma.componentQACheck.delete({ where: { id: checkId } });
      return NextResponse.json({ removed: checkId });
    }

    return NextResponse.json({ error: "action must be approve or discard" }, { status: 400 });
  } catch (err) {
    return handleApiError(err);
  }
}
