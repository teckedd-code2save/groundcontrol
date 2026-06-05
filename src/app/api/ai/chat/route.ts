import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getOpenAIKey } from "@/lib/ai-config";
import OpenAI from "openai";

function getOpenAI() {
  return new OpenAI({ apiKey: getOpenAIKey() });
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { messages } = (await req.json()) as { messages: OpenAI.Chat.ChatCompletionMessageParam[] };

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Messages array required" }, { status: 400 });
    }

    const apiKey = getOpenAIKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured. Add it in Settings → AI Configuration." },
        { status: 503 }
      );
    }

    const systemPrompt = {
      role: "system" as const,
      content:
        `You are GroundControl AI, an expert systems administrator and DevOps assistant embedded in the GroundControl VPS cockpit dashboard.\n\n` +
        `You help with:\n` +
        `- Docker and container orchestration\n` +
        `- Caddy/Nginx reverse proxy configuration\n` +
        `- Linux server administration\n` +
        `- Debugging deployments and services\n` +
        `- Interpreting logs and metrics\n` +
        `- Best practices for VPS security and performance\n\n` +
        `Be concise, practical, and assume the user is running Ubuntu/Debian on a VPS. ` +
        `If asked about GroundControl-specific features, reference the dashboard pages (Topology, XRay, Terminal, Alerts, Sites, Deployments).`,
    };

    const stream = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [systemPrompt, ...messages],
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) {
            controller.enqueue(encoder.encode(text));
          }
        }
        controller.close();
      },
    });

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "AI request failed" },
      { status: 500 }
    );
  }
}
