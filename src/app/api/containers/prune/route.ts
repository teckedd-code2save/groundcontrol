import { NextResponse } from "next/server";
import { pruneDocker } from "@/lib/vps";

export async function POST() {
  try {
    const result = await pruneDocker();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
