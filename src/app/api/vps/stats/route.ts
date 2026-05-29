import { NextResponse } from "next/server";
import { getSystemStats } from "@/lib/vps";

export async function GET() {
  try {
    const stats = await getSystemStats();
    return NextResponse.json(stats);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
