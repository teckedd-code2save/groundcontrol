import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runRollback } from "@/lib/deploy/pipeline";
import { handleApiError } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req);

    const { id } = await params;
    const deploymentId = parseInt(id, 10);
    if (!Number.isFinite(deploymentId)) {
      return NextResponse.json({ error: "Invalid deployment id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({})) as { rollbackTo?: string };
    const rollbackTo = body.rollbackTo === "self" ? "self" : "previous";
    await runRollback(deploymentId, { rollbackTo });
    return NextResponse.json({ ok: true, status: "rolled_back" });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
