import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runRollback } from "@/lib/deploy/pipeline";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

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

    await runRollback(deploymentId);
    return NextResponse.json({ ok: true, status: "rolled_back" });
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
