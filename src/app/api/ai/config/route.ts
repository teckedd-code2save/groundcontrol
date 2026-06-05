import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getAiConfig, setAiConfig } from "@/lib/ai-config";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const config = getAiConfig();
    return NextResponse.json({
      configured: !!config.openaiApiKey,
      hasEnvKey: !!process.env.OPENAI_API_KEY,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { openaiApiKey } = await req.json();
    const current = getAiConfig();
    setAiConfig({ ...current, openaiApiKey: openaiApiKey || undefined });
    return NextResponse.json({ success: true, configured: !!openaiApiKey });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
