import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);

    const deployments = await prisma.deployment.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        project: { select: { id: true, slug: true, name: true } },
        target: { select: { id: true, name: true, type: true } },
      },
    });

    return NextResponse.json(deployments);
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
