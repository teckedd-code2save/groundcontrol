import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLoopEngine, getServicePath } from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

/** GET domain → proxy → container path. Read-only. */
export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const domain = req.nextUrl.searchParams.get("domain");
    if (!domain) {
      return NextResponse.json({ error: "domain query param required" }, { status: 400 });
    }
    const state = getLoopEngine();
    const path = getServicePath(state, domain);
    if (!path) {
      return NextResponse.json({ error: "path not found", domain }, { status: 404 });
    }
    return NextResponse.json({ path });
  } catch (err) {
    return errorResponse(err);
  }
}
