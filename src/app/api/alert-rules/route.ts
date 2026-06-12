import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const rules = await prisma.alertRule.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json(rules);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = (await req.json()) as Record<string, unknown>;
    const { id, name, metric, operator, threshold, durationSec, severity, enabled } = body;

    if (!name || !metric || !operator || threshold === undefined) {
      return NextResponse.json(
        { error: "name, metric, operator, and threshold are required" },
        { status: 400 }
      );
    }

    const data = {
      name: String(name),
      metric: String(metric),
      operator: String(operator),
      threshold: Number(threshold),
      durationSec: Number(durationSec || 60),
      severity: String(severity || "warning"),
      enabled: enabled !== false,
    };

    if (id) {
      const updated = await prisma.alertRule.update({ where: { id: Number(id) }, data });
      return NextResponse.json(updated);
    }

    const created = await prisma.alertRule.create({ data });
    return NextResponse.json(created);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAuth(req);
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Rule id required" }, { status: 400 });
    }
    await prisma.alertRule.delete({ where: { id: Number(id) } });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
