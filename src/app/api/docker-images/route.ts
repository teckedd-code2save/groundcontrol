import { NextResponse } from "next/server";
import { getDockerImages } from "@/lib/vps";

export async function GET() {
  try {
    const images = await getDockerImages();
    return NextResponse.json(images);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
