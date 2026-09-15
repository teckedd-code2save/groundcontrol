import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { detectServerCapabilities } from "@/lib/server-capabilities";
import { handleApiError } from "@/lib/errors";
import { requireTerminalAdmin, resolveTerminalTarget } from "@/lib/terminal-execution";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const targetId = req.nextUrl.searchParams.get("vpsId");
    if (targetId !== null) await requireTerminalAdmin(req);
    const target = targetId === null ? undefined : await resolveTerminalTarget(Number(targetId));
    const caps = await detectServerCapabilities(target);
    return NextResponse.json(caps);
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
