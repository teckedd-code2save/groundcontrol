import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveAi, getAiModel } from "@/lib/ai-config";
import {
  getTool,
  getOpenAIToolSchemas,
  getAnthropicToolSchemas,
  isReadOnlyTool,
} from "@/lib/ai-agent";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// Always run at request time — this handler streams and hits the VPS.
export const dynamic = "force-dynamic";

/**
 * Active model resolved from env vars > ai-config.json. The provider-specific
 * value is chosen at request time so model overrides take effect immediately.
 */
function resolveModel() {
  return getAiModel();
}

const MAX_TOOL_ITERATIONS = 6;
const ANTHROPIC_MAX_TOKENS = 4096;

const SYSTEM_PROMPT =
  `You are GroundControl AI, an expert systems administrator and DevOps assistant embedded in the ` +
  `GroundControl VPS cockpit dashboard. You are an AGENT: you CAN directly inspect the connected ` +
  `server by calling the provided tools, which execute real shell/Docker commands on the active VPS ` +
  `over SSH (or locally).\n\n` +
  `CRITICAL BEHAVIOR:\n` +
  `- When the user asks anything answerable by inspecting the server (memory/CPU usage, which service ` +
  `is heaviest, container status, logs, disk usage, proxy config, etc.), DO NOT tell the user to run ` +
  `commands themselves and DO NOT claim you lack access. Instead, CALL THE APPROPRIATE TOOL and report ` +
  `the real findings.\n` +
  `- Prefer the dedicated tools (system_stats, top_memory_processes, top_cpu_processes, list_containers, ` +
  `container_stats, container_logs, list_projects, disk_usage, read_proxy_config, read_compose_config, ` +
  `list_project_containers, compose_ps). Use run_diagnostic only for read-only inspection that no ` +
  `dedicated tool covers.\n` +
  `- Chain tools as needed: e.g. to find which service uses the most memory, call top_memory_processes ` +
  `and/or container_stats, then summarize.\n` +
  `- DO NOT assume every container belongs to the project the user mentioned. Use list_project_containers ` +
  `to find containers that actually belong to a project, and read_compose_config to see which services ` +
  `are DECLARED in the compose file. A project may have declared services that are not currently running.\n` +
  `- For compose projects, use compose_up / compose_down for starting/stopping the declared services. ` +
  `NEVER use start_container/stop_container/restart_container for services that have not been created ` +
  `yet; those only work on existing containers. If the user says "up the containers from the images" ` +
  `for a compose project, call compose_up.\n` +
  `- Before starting compose services, read_compose_config if you have not already, so you know the ` +
  `service names, images, ports, and dependencies.\n` +
  `- Be honest about limits: destructive/mutating actions (restart/start/stop containers, compose_up, ` +
  `compose_down) require explicit user confirmation in the UI — you cannot perform them silently. ` +
  `Propose them, but the user must approve before they run.\n` +
  `- If a tool returns an error (e.g. the VPS is unreachable), say so plainly and suggest next steps; ` +
  `do not invent results.\n\n` +
  `Be concise and practical. Assume a Linux VPS (could be Debian/Ubuntu or Alpine/BusyBox). When useful, ` +
  `reference GroundControl dashboard pages (Topology, XRay, Terminal, Alerts, Sites, Projects). Format ` +
  `answers in clean Markdown.`;

type WireMessage = { role: string; content: string };
type ConfirmedTool = { name: string; args: Record<string, unknown> };

const encoder = new TextEncoder();
function sse(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj) + "\n");
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const body = (await req.json()) as {
      messages: WireMessage[];
      // When the user approves a mutating tool, the client re-calls with this set.
      confirmedTool?: ConfirmedTool;
    };
    const { messages, confirmedTool } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Messages array required" }, { status: 400 });
    }

    const { provider, apiKey } = getActiveAi();
    if (!apiKey) {
      const label = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      return NextResponse.json(
        { error: `${label} not configured. Add it in Settings → AI Configuration.` },
        { status: 503 }
      );
    }

    const history = messages.filter((m) => m.role === "user" || m.role === "assistant");

    const readable = new ReadableStream({
      async start(controller) {
        const emit = (obj: unknown) => controller.enqueue(sse(obj));
        try {
          if (provider === "anthropic") {
            await runAnthropic(apiKey, history, confirmedTool, emit);
          } else {
            await runOpenAI(apiKey, history, confirmedTool, emit);
          }
          controller.close();
        } catch (err: unknown) {
          try {
            emit({ type: "error", error: err instanceof Error ? err.message : "AI request failed" });
          } catch {
            // controller may already be closed
          }
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI request failed";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

type Emit = (obj: unknown) => void;

// ---------------------------------------------------------------------------
// OpenAI provider (chat completions + function calling)
// ---------------------------------------------------------------------------
async function runOpenAI(
  apiKey: string,
  history: WireMessage[],
  confirmedTool: ConfirmedTool | undefined,
  emit: Emit
) {
  const openai = new OpenAI({ apiKey });
  const toolSchemas = getOpenAIToolSchemas();

  const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  if (confirmedTool?.name) {
    const tool = getTool(confirmedTool.name);
    if (!tool) {
      emit({ type: "tool", name: confirmedTool.name, status: "error", output: "Unknown tool." });
    } else {
      const cArgs = confirmedTool.args || {};
      emit({ type: "tool", name: tool.name, args: cArgs, status: "running" });
      const output = await tool.execute(cArgs);
      emit({ type: "tool", name: tool.name, args: cArgs, status: "done", output });
      convo.push({
        role: "assistant",
        content: `I executed the confirmed action \`${tool.name}\` with arguments ${JSON.stringify(cArgs)}.`,
      });
      convo.push({
        role: "user",
        content: `Result of ${tool.name}:\n\n${output}\n\nPlease summarize the outcome.`,
      });
    }
  }

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion = await openai.chat.completions.create({
      model: resolveModel(),
      messages: convo,
      tools: toolSchemas,
      tool_choice: "auto",
      temperature: 0.4,
    });

    const msg = completion.choices[0]?.message;
    const toolCalls = msg?.tool_calls || [];

    if (!toolCalls.length) {
      if (msg?.content) {
        emit({ type: "text", delta: msg.content });
        return;
      }
      break;
    }

    convo.push(msg as OpenAI.Chat.ChatCompletionMessageParam);
    let awaitingConfirmation = false;

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      const tool = getTool(name);
      if (!tool) {
        convo.push({ role: "tool", tool_call_id: call.id, content: `ERROR: unknown tool "${name}".` });
        continue;
      }

      if (!isReadOnlyTool(name)) {
        emit({ type: "confirm", name, args, description: tool.description });
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          content: `This is a mutating action and was NOT executed. It is pending explicit user confirmation in the UI.`,
        });
        awaitingConfirmation = true;
        continue;
      }

      emit({ type: "tool", name, args, status: "running" });
      const output = await tool.execute(args);
      emit({ type: "tool", name, args, status: "done", output });
      convo.push({ role: "tool", tool_call_id: call.id, content: output });
    }

    if (awaitingConfirmation) {
      emit({
        type: "text",
        delta:
          "\n\nThis action changes server state, so I need your confirmation before running it. " +
          "Approve it above to proceed.",
      });
      return;
    }
  }

  const finalStream = await openai.chat.completions.create({
    model: resolveModel(),
    messages: convo,
    stream: true,
    temperature: 0.4,
  });
  for await (const chunk of finalStream) {
    const delta = chunk.choices[0]?.delta?.content || "";
    if (delta) emit({ type: "text", delta });
  }
}

// ---------------------------------------------------------------------------
// Anthropic provider (Messages API + tool use). claude-opus-4-8 uses adaptive
// thinking only and rejects sampling params, so we pass neither temperature nor
// budget_tokens.
// ---------------------------------------------------------------------------
async function runAnthropic(
  apiKey: string,
  history: WireMessage[],
  confirmedTool: ConfirmedTool | undefined,
  emit: Emit
) {
  const anthropic = new Anthropic({ apiKey });
  const tools = getAnthropicToolSchemas();

  const convo: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  if (confirmedTool?.name) {
    const tool = getTool(confirmedTool.name);
    if (!tool) {
      emit({ type: "tool", name: confirmedTool.name, status: "error", output: "Unknown tool." });
    } else {
      const cArgs = confirmedTool.args || {};
      emit({ type: "tool", name: tool.name, args: cArgs, status: "running" });
      const output = await tool.execute(cArgs);
      emit({ type: "tool", name: tool.name, args: cArgs, status: "done", output });
      convo.push({
        role: "assistant",
        content: `I executed the confirmed action \`${tool.name}\` with arguments ${JSON.stringify(cArgs)}.`,
      });
      convo.push({
        role: "user",
        content: `Result of ${tool.name}:\n\n${output}\n\nPlease summarize the outcome.`,
      });
    }
  }

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const stream = anthropic.messages.stream({
      model: resolveModel(),
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      messages: convo,
    });

    // Stream assistant text as it arrives (preambles + the final answer).
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (event.delta.text) emit({ type: "text", delta: event.delta.text });
      }
    }

    const finalMsg = await stream.finalMessage();

    // No tool use -> the streamed text above was the final answer.
    if (finalMsg.stop_reason !== "tool_use") return;

    const toolUses = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    // Preserve the assistant turn (text + tool_use blocks) verbatim.
    convo.push({ role: "assistant", content: finalMsg.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let awaitingConfirmation = false;

    for (const use of toolUses) {
      const name = use.name;
      const args = (use.input as Record<string, unknown>) || {};
      const tool = getTool(name);

      if (!tool) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `ERROR: unknown tool "${name}".`,
          is_error: true,
        });
        continue;
      }

      if (!isReadOnlyTool(name)) {
        emit({ type: "confirm", name, args, description: tool.description });
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content:
            "This is a mutating action and was NOT executed. It is pending explicit user confirmation in the UI.",
        });
        awaitingConfirmation = true;
        continue;
      }

      emit({ type: "tool", name, args, status: "running" });
      const output = await tool.execute(args);
      emit({ type: "tool", name, args, status: "done", output });
      toolResults.push({ type: "tool_result", tool_use_id: use.id, content: output });
    }

    convo.push({ role: "user", content: toolResults });

    if (awaitingConfirmation) {
      emit({
        type: "text",
        delta:
          "\n\nThis action changes server state, so I need your confirmation before running it. " +
          "Approve it above to proceed.",
      });
      return;
    }
  }
}
