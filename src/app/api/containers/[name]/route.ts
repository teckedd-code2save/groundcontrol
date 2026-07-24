import { NextResponse } from "next/server";
import { getContainerDetail } from "@/lib/container-details";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    return NextResponse.json(await getContainerDetail(decodeURIComponent(name)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not inspect the container.";
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
