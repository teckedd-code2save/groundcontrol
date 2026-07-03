import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";

function isTemplateManagedTarget(target: { name: string; configJson: string | null }): boolean {
  if (target.name.startsWith("Template: ")) return true;
  try {
    const config = JSON.parse(target.configJson || "{}") as { managedBy?: unknown };
    return config.managedBy === "template-deploy";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const includeTemplateManaged = req.nextUrl.searchParams.get("includeTemplateManaged") === "1";

    const targets = await prisma.deploymentTarget.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        vps: { select: { id: true, name: true, host: true } },
        cloudAccount: { select: { id: true, name: true, provider: true } },
      },
    });

    return NextResponse.json(includeTemplateManaged ? targets : targets.filter((target) => !isTemplateManagedTarget(target)));
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
