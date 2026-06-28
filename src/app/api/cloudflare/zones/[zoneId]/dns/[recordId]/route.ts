import { NextRequest, NextResponse } from "next/server";
import { deleteDnsRecord } from "@/lib/cloudflare";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ zoneId: string; recordId: string }> }
) {
  try {
    const { zoneId, recordId } = await params;
    await deleteDnsRecord(zoneId, recordId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
