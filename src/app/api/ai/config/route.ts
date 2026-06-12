import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getAiConfig, setAiConfig, getAiProvider, type AiProvider } from "@/lib/ai-config";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const config = getAiConfig();
    return NextResponse.json({
      provider: getAiProvider(),
      openai: {
        configured: !!config.openaiApiKey,
        hasEnvKey: !!process.env.OPENAI_API_KEY,
      },
      anthropic: {
        configured: !!config.anthropicApiKey,
        hasEnvKey: !!process.env.ANTHROPIC_API_KEY,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json();
    const current = getAiConfig();

    const next = { ...current };

    // Provider selection (optional; only update when explicitly provided).
    if (body.provider === "openai" || body.provider === "anthropic") {
      next.provider = body.provider as AiProvider;
    }
    // Keys: a provided string sets/replaces; `null`/empty clears that key.
    if ("openaiApiKey" in body) next.openaiApiKey = body.openaiApiKey || undefined;
    if ("anthropicApiKey" in body) next.anthropicApiKey = body.anthropicApiKey || undefined;

    setAiConfig(next);

    return NextResponse.json({
      success: true,
      provider: getAiProvider(),
      openai: { configured: !!next.openaiApiKey, hasEnvKey: !!process.env.OPENAI_API_KEY },
      anthropic: { configured: !!next.anthropicApiKey, hasEnvKey: !!process.env.ANTHROPIC_API_KEY },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
