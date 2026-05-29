import { NextRequest, NextResponse } from "next/server";
import { testConnection } from "@/lib/vps";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const result = await testConnection(body);
  return NextResponse.json(result);
}
