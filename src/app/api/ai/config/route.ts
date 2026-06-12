import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getAiConfig, setAiConfig, getAiProvider, getAiModel, type AiProvider } from "@/lib/ai-config";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const config = getAiConfig();
    const provider = getAiProvider();
    return NextResponse.json({
      provider,
      model: getAiModel(),
      envModel: provider === "anthropic" ? process.env.AI_MODEL_ANTHROPIC : (process.env.AI_MODEL_OPENAI || process.env.AI_MODEL),
      openai: {
        configured: !!config.openaiApiKey,
        hasEnvKey: !!process.env.OPENAI_API_KEY,
      },
      anthropic: {
        configured: !!config.anthropicApiKey,
        hasEnvKey: !!process.env.ANTHROPIC_API_KEY,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body: {
      provider?: string;
      model?: string;
      openaiApiKey?: string;
      anthropicApiKey?: string;
    } = await req.json();
    const current = getAiConfig();

    const next = { ...current };

    // Provider selection (optional; only update when explicitly provided).
    if (body.provider === "openai" || body.provider === "anthropic") {
      next.provider = body.provider as AiProvider;
    }
    // Model override (optional; only update when explicitly provided).
    if ("model" in body) next.model = body.model || undefined;
    // Keys: a provided string sets/replaces; `null`/empty clears that key.
    if ("openaiApiKey" in body) next.openaiApiKey = body.openaiApiKey || undefined;
    if ("anthropicApiKey" in body) next.anthropicApiKey = body.anthropicApiKey || undefined;

    setAiConfig(next);

    return NextResponse.json({
      success: true,
      provider: getAiProvider(),
      model: getAiModel(),
      envModel: next.provider === "anthropic" ? process.env.AI_MODEL_ANTHROPIC : (process.env.AI_MODEL_OPENAI || process.env.AI_MODEL),
      openai: { configured: !!next.openaiApiKey, hasEnvKey: !!process.env.OPENAI_API_KEY },
      anthropic: { configured: !!next.anthropicApiKey, hasEnvKey: !!process.env.ANTHROPIC_API_KEY },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
