// src/app/api/onboarding/probe/route.ts
import { NextResponse } from "next/server";
import { deepProbe } from "@/lib/deep-probe";

export async function GET() {
  try {
    const result = await deepProbe();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Probe failed", summary: "Probe failed" },
      { status: 500 }
    );
  }
}
