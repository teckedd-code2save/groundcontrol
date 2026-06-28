import { NextRequest, NextResponse } from "next/server";
import { listDnsRecords, createDnsRecord } from "@/lib/cloudflare";

export async function GET(req: NextRequest, { params }: { params: Promise<{ zoneId: string }> }) {
  try {
    const { zoneId } = await params;
    const records = await listDnsRecords(zoneId);
    const simplified = (records as any[]).map((r: any) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      ttl: r.ttl || 1,
      proxied: r.proxied ?? false,
    }));
    return NextResponse.json({ records: simplified });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ zoneId: string }> }) {
  try {
    const { zoneId } = await params;
    const body = await req.json();
    const record = await createDnsRecord(zoneId, {
      type: body.type || "A",
      name: body.name,
      content: body.content,
      ttl: body.ttl || 1,
      proxied: body.proxied !== false,
    });
    return NextResponse.json({ success: true, record });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
