import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { installKubectl } from "@/lib/bootstrap";
import { handleApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const result = await installKubectl();
    return NextResponse.json(result);
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
