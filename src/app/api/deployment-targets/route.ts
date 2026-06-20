import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);

    const targets = await prisma.deploymentTarget.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        vps: { select: { id: true, name: true, host: true } },
        cloudAccount: { select: { id: true, name: true, provider: true } },
      },
    });

    return NextResponse.json(targets);
  } catch (err: unknown) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const body = await req.json();
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!body.type || typeof body.type !== "string") {
      return NextResponse.json({ error: "type is required" }, { status: 400 });
    }

    const target = await prisma.deploymentTarget.create({
      data: {
        name: body.name,
        type: body.type,
        vpsConfigId: body.vpsConfigId ?? null,
        cloudProviderAccountId: body.cloudProviderAccountId ?? null,
        configJson: typeof body.configJson === "string" ? body.configJson : "{}",
        isActive: body.isActive === true,
      },
      include: {
        vps: { select: { id: true, name: true, host: true } },
        cloudAccount: { select: { id: true, name: true, provider: true } },
      },
    });

    return NextResponse.json(target, { status: 201 });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
