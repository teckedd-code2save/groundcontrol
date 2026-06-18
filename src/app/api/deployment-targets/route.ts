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

    const targets = await prisma.deploymentTarget.findMany({
      orderBy: { updatedAt: "desc" },
      include: { vps: { select: { id: true, name: true, host: true } } },
    });

    return NextResponse.json(targets);
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
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
        configJson: typeof body.configJson === "string" ? body.configJson : "{}",
        isActive: body.isActive === true,
      },
      include: { vps: { select: { id: true, name: true, host: true } } },
    });

    return NextResponse.json(target, { status: 201 });
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
