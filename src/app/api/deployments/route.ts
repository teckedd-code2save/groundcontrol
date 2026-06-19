import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";

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
    return handleApiError(err);
  }
}
