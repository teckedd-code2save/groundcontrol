// src/app/api/project-runtime/route.ts
import { NextResponse } from "next/server";
import { buildProjectRuntime } from "@/lib/project-runtime";

export async function GET() {
  try {
    const runtime = await buildProjectRuntime();
    return NextResponse.json(runtime);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build project runtime" },
      { status: 500 }
    );
  }
}
