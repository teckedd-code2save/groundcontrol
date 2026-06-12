import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { installDocker } from "@/lib/bootstrap";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const result = await installDocker();
    return NextResponse.json(result);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
