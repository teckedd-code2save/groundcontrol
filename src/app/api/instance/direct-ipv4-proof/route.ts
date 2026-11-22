import { NextRequest, NextResponse } from "next/server";
import { issueDirectIpv4Proof } from "@/lib/direct-ipv4-access";
import { requestOrigin } from "@/lib/oauth";

export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  try {
    const proof = await issueDirectIpv4Proof(
      requestOrigin(req),
      req.headers.get("x-groundcontrol-ip-challenge"),
      req.headers.get("x-groundcontrol-ip-route"),
    );
    if (proof) return NextResponse.json({ proof }, { headers });
  } catch {
    // Keep the public response uniform; never disclose pending state or secrets.
  }
  return new NextResponse(null, { status: 404, headers });
}
