import { NextResponse } from "next/server";
import { listZones, getActiveCloudflareAccount } from "@/lib/cloudflare";

export async function GET() {
  try {
    const account = await getActiveCloudflareAccount();
    if (!account) return NextResponse.json({ error: "No active Cloudflare account. Add one in Settings → Cloudflare." }, { status: 400 });
    const zones = await listZones(account);
    const simplified = (zones as any[]).map((z: any) => ({
      id: z.id,
      name: z.name,
      status: z.status,
    }));
    return NextResponse.json({ zones: simplified });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to list zones" }, { status: 500 });
  }
}
