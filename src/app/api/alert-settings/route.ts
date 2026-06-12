import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getOrCreateAlertSettings } from "@/lib/alert-rules";
import { prisma } from "@/lib/prisma";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const settings = await getOrCreateAlertSettings();
    return NextResponse.json(settings);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = (await req.json()) as Record<string, unknown>;
    const { retentionDays } = body;

    if (retentionDays === undefined || Number.isNaN(Number(retentionDays))) {
      return NextResponse.json({ error: "retentionDays is required" }, { status: 400 });
    }

    const settings = await getOrCreateAlertSettings();
    const updated = await prisma.alertSetting.update({
      where: { id: settings.id },
      data: { retentionDays: Number(retentionDays) },
    });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
