import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  getOrCreateHealthCheckConfig,
  clampInterval,
  getRecentHealthResults,
} from "@/lib/health-checks";
import { prisma } from "@/lib/prisma";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const config = await getOrCreateHealthCheckConfig();
    const results = await getRecentHealthResults(
      parseInt(req.nextUrl.searchParams.get("limit") || "200")
    );
    return NextResponse.json({ config, results });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = (await req.json()) as Record<string, unknown>;
    const { intervalSec, enabled, severity } = body;

    const config = await getOrCreateHealthCheckConfig();
    const data: Record<string, unknown> = {};

    if (intervalSec !== undefined) {
      data.intervalSec = clampInterval(Number(intervalSec));
    }
    if (enabled !== undefined) {
      data.enabled = Boolean(enabled);
    }
    if (severity !== undefined) {
      const valid = ["info", "warning", "error", "critical"];
      if (!valid.includes(String(severity))) {
        return NextResponse.json(
          { error: `severity must be one of: ${valid.join(", ")}` },
          { status: 400 }
        );
      }
      data.severity = String(severity);
    }

    const updated = await prisma.healthCheckConfig.update({
      where: { id: config.id },
      data,
    });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
