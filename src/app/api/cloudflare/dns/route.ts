import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listDnsRecords, createDnsRecord, updateDnsRecord } from "@/lib/cloudflare";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const zoneId = req.nextUrl.searchParams.get("zoneId");
    if (!zoneId) {
      return NextResponse.json({ error: "zoneId is required" }, { status: 400 });
    }
    const records = await listDnsRecords(zoneId);
    return NextResponse.json(records);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json();
    const { zoneId, recordId, type, name, content, ttl, proxied, comment } = body;

    if (!zoneId || !type || !name || content === undefined) {
      return NextResponse.json({ error: "zoneId, type, name, and content are required" }, { status: 400 });
    }

    const data = { type, name, content, ttl: ttl ?? 1, proxied: proxied ?? false, comment };

    const record = recordId
      ? await updateDnsRecord(zoneId, recordId, data)
      : await createDnsRecord(zoneId, data);

    return NextResponse.json(record);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
