import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { upsertGuidesFromDisk } from "@/lib/guides/loader";

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin required" }, { status: 403 });
    }

    const { created, updated } = await upsertGuidesFromDisk();
    return NextResponse.json({ ok: true, created, updated });
  } catch (err) {
    return handleApiError(err);
  }
}
