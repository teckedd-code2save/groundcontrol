import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { execOnVps, shQuote } from "@/lib/vps";

/**
 * GET /api/projects/compose/log?slug=groundcontrol
 *
 * Returns the last 200 lines from the redeploy log file.
 * Used by the UI to show live redeploy progress.
 */
export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    if (!slug || !/^[A-Za-z0-9_.-]+$/.test(slug)) {
      return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    }
    const logFile = `/tmp/gc-redeploy-${slug}.log`;
    const result = await execOnVps(`tail -n 200 ${shQuote(logFile)} 2>/dev/null || echo ""`);
    const lines = result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
    return NextResponse.json({ slug, lines, count: lines.length });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
