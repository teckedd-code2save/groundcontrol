import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { evaluateAlertRules, cleanupOldAlerts } from "@/lib/alert-rules";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const enabledCount = await prisma.alertRule.count({ where: { enabled: true } });
    const created = await evaluateAlertRules();
    const cleanup = await cleanupOldAlerts();
    return NextResponse.json({ evaluated: enabledCount, created: created.length, cleanup, deleted: cleanup });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
