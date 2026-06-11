import { NextRequest, NextResponse } from "next/server";
import { getContainerLogs } from "@/lib/vps";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name") || "";
  const tail = parseInt(searchParams.get("tail") || "100");

  if (!name.trim()) {
    return NextResponse.json({ error: "Container name required" }, { status: 400 });
  }

  try {
    const logs = await getContainerLogs(name, tail);
    return NextResponse.json({ logs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
