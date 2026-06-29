import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveAi, getAiModel } from "@/lib/ai-config";
import {
  getTool,
  getOpenAIToolSchemas,
  getAnthropicToolSchemas,
  isReadOnlyTool,
} from "@/lib/ai-agent";
import { auditAiToolExecution } from "@/lib/audit";
import {
  createAiThread,
  getAiThread,
  appendAiMessage,
  recordAiToolCall,
  recordAiUsage,
  updateAiThread,
  titleFromMessage,
  type WireMessage,
  type ToolCallRecord,
} from "@/lib/ai-memory";
import { getHostCapabilities, formatCapabilitiesForPrompt } from "@/lib/host-capabilities";
import { formatGuideContextForPrompt } from "@/lib/guides/ai-context";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

function resolveModel() {
  return getAiModel();
}

const MAX_TOOL_ITERATIONS = 6;
const ANTHROPIC_MAX_TOKENS = 4096;

const SYSTEM_PROMPT =
  `You are GroundControl AI, an expert systems administrator and DevOps assistant embedded in the ` +
  `GroundControl VPS command center. You are an AGENT: you CAN directly inspect the connected ` +
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

type ConfirmedTool = { name: string; args: Record<string, unknown> };

interface RequestBody {
  threadId?: number;
  message?: string;
  confirmedTool?: ConfirmedTool;
  guideContext?: { guideSlug: string; stepId?: string };
}

const encoder = new TextEncoder();
function sse(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj) + "\n");
}

/** Simple per-model cost heuristic. Falls back to zero when unknown. */
function estimateCostUsd(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const key = `${provider}:${model}`.toLowerCase();
  // Approximate prices per 1M tokens (input / output).
  const rates: Record<string, [number, number]> = {
    "openai:gpt-4o": [2.5, 10],
    "openai:gpt-4o-mini": [0.15, 0.6],
    "anthropic:claude-3-5-sonnet-latest": [3, 15],
    "anthropic:claude-3-5-haiku-latest": [0.8, 4],
  };
  const match = Object.entries(rates).find(([k]) => key.startsWith(k));
  if (!match) return 0;
  const [inRate, outRate] = match[1];
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);

    const body = (await req.json()) as RequestBody;
    const { threadId: existingThreadId, message, confirmedTool, guideContext } = body;

    const { provider, apiKey } = getActiveAi();
    if (!apiKey) {
      const label = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      return NextResponse.json(
        { error: `${label} not configured. Add it in Settings → AI Configuration.` },
        { status: 503 }
      );
    }

    // Resolve or create the thread.
    let threadId: number;
    if (existingThreadId) {
      const existing = await getAiThread(existingThreadId, user.id);
      if (!existing) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 });
      }
      threadId = existing.id;
    } else {
      const thread = await createAiThread(user.id);
      threadId = thread.id;
    }

    const context = {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
    };

    const readable = new ReadableStream({
      async start(controller) {
        const emit = (obj: unknown) => controller.enqueue(sse(obj));
        emit({ type: "thread", threadId });

        try {
          const caps = await getHostCapabilities().catch(() => null);
          const capabilityPreamble = caps ? formatCapabilitiesForPrompt(caps) : "";
          // Inject live project/container state so the agent knows what's running
          let runtimePreamble = "";
          try {
            const { buildProjectRuntime } = await import("@/lib/project-runtime");
            const rt = await buildProjectRuntime();
            if (rt.summary) runtimePreamble = `Current server state — ${rt.summary}`;
          } catch { /* non-critical */ }
          const guidePreamble = guideContext
            ? await formatGuideContextForPrompt(user.id, guideContext).catch(() => "")
            : "";

          const parts = [SYSTEM_PROMPT];
          if (capabilityPreamble) parts.unshift(capabilityPreamble);
          if (runtimePreamble) parts.unshift(runtimePreamble);
          if (guidePreamble) parts.unshift(guidePreamble);
          const systemPrompt = parts.join("\n\n");

          // Let the agent know it can query/install/manage the host.
          // Record the incoming user message if present.
          if (message?.trim()) {
            await appendAiMessage(threadId, "user", message.trim());
            const count = await (await import("@/lib/prisma")).prisma.aiMessage.count({
              where: { threadId, role: "user" },
            });
            if (count === 1) {
              await updateAiThread(threadId, user.id, titleFromMessage(message.trim()));
            }
          }

          // Collect everything that happens this turn so we can persist it.
          const turn: {
            content: string;
            toolCalls: (ToolCallRecord & { persistedId?: number })[];
            usage: { inputTokens: number; outputTokens: number } | null;
          } = {
            content: "",
            toolCalls: [],
            usage: null,
          };

          if (confirmedTool?.name) {
            await handleConfirmedTool({
              threadId,
              confirmedTool,
              provider,
              apiKey,
              emit,
              turn,
              userId: user.id,
              context,
              systemPrompt,
            });
          } else {
            if (provider === "anthropic") {
              await runAnthropic({ apiKey, threadId, userId: user.id, context, systemPrompt, emit, turn });
            } else {
              await runOpenAI({ apiKey, threadId, userId: user.id, context, systemPrompt, emit, turn });
            }
          }

          // Persist the assistant message and its tool calls.
          const assistantMsg = await appendAiMessage(threadId, "assistant", turn.content, {
            provider,
            model: resolveModel(),
          });
          for (const tc of turn.toolCalls) {
            await recordAiToolCall(assistantMsg.id, tc);
          }

          // Persist usage if any was captured.
          if (turn.usage) {
            await recordAiUsage({
              threadId,
              messageId: assistantMsg.id,
              provider,
              model: resolveModel(),
              inputTokens: turn.usage.inputTokens,
              outputTokens: turn.usage.outputTokens,
              totalTokens: turn.usage.inputTokens + turn.usage.outputTokens,
              costUsd: estimateCostUsd(provider, resolveModel(), turn.usage.inputTokens, turn.usage.outputTokens),
            });
          }

          emit({ type: "done" });
          controller.close();
        } catch (err: unknown) {
          emit({ type: "error", error: err instanceof Error ? err.message : "AI request failed" });
          controller.close();
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

interface RunCtx {
  apiKey: string;
  threadId: number;
  userId: number;
  context: { ip: string; userAgent: string };
  systemPrompt: string;
  emit: Emit;
  turn: {
    content: string;
    toolCalls: (ToolCallRecord & { persistedId?: number })[];
    usage: { inputTokens: number; outputTokens: number } | null;
  };
}

// Use raw Prisma query so we don't need the userId guard inside the streaming worker.
async function loadThreadMessages(threadId: number): Promise<WireMessage[]> {
  const { prisma } = await import("@/lib/prisma");
  const messages = await prisma.aiMessage.findMany({
    where: { threadId },
    orderBy: { sortOrder: "asc" },
    select: { role: true, content: true },
  });
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

interface ConfirmedToolCtx extends RunCtx {
  confirmedTool: ConfirmedTool;
  provider: string;
}

async function handleConfirmedTool(ctx: ConfirmedToolCtx) {
  const { confirmedTool, provider, apiKey, threadId, emit, turn, userId, context, systemPrompt } = ctx;
  const tool = getTool(confirmedTool.name);
  if (!tool) {
    emit({ type: "tool", name: confirmedTool.name, status: "error", output: "Unknown tool." });
    turn.toolCalls.push({
      name: confirmedTool.name,
      args: confirmedTool.args,
      output: "Unknown tool.",
      status: "error",
      readOnly: false,
    });
    return;
  }

  emit({ type: "tool", name: tool.name, args: confirmedTool.args, status: "running" });
  const output = await tool.execute(confirmedTool.args);
  emit({ type: "tool", name: tool.name, args: confirmedTool.args, status: "done", output });

  turn.toolCalls.push({
    name: tool.name,
    args: confirmedTool.args,
    output,
    status: "done",
    readOnly: false,
    confirmedAt: new Date(),
  });

  await auditAiToolExecution(userId, {
    threadId,
    name: tool.name,
    args: confirmedTool.args,
    output,
    readOnly: false,
    confirmed: true,
    context,
  });

  const convo = [
    { role: "system", content: systemPrompt },
    ...await loadThreadMessages(threadId),
    {
      role: "assistant",
      content: `I executed the confirmed action \`${tool.name}\` with arguments ${JSON.stringify(confirmedTool.args)}.`,
    },
    {
      role: "user",
      content: `Result of ${tool.name}:\n\n${output}\n\nPlease summarize the outcome.`,
    },
  ] as WireMessage[];

  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey });
    const stream = anthropic.messages.stream({
      model: resolveModel(),
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: systemPrompt,
      messages: convo.filter((m) => m.role !== "system") as Anthropic.MessageParam[],
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const delta = event.delta.text;
        if (delta) {
          turn.content += delta;
          emit({ type: "text", delta });
        }
      }
    }
    const finalMsg = await stream.finalMessage();
    if (finalMsg.usage) {
      turn.usage = {
        inputTokens: finalMsg.usage.input_tokens,
        outputTokens: finalMsg.usage.output_tokens,
      };
    }
  } else {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: resolveModel(),
      messages: [
        { role: "system", content: systemPrompt },
        ...convo.filter((m) => m.role !== "system").map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      stream: true,
      temperature: 0.4,
    });
    for await (const chunk of completion) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) {
        turn.content += delta;
        emit({ type: "text", delta });
      }
    }
  }
}

async function runOpenAI(ctx: RunCtx) {
  const { apiKey, threadId, emit, turn, systemPrompt } = ctx;
  const openai = new OpenAI({ apiKey });
  const toolSchemas = getOpenAIToolSchemas();

  const history = await loadThreadMessages(threadId);
  const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion = await openai.chat.completions.create({
      model: resolveModel(),
      messages: convo,
      tools: toolSchemas,
      tool_choice: "auto",
      temperature: 0.4,
    });

    if (completion.usage) {
      turn.usage = {
        inputTokens: completion.usage.prompt_tokens,
        outputTokens: completion.usage.completion_tokens,
      };
    }

    const msg = completion.choices[0]?.message;
    const toolCalls = msg?.tool_calls || [];

    if (!toolCalls.length) {
      if (msg?.content) {
        turn.content += msg.content;
        emit({ type: "text", delta: msg.content });
      }
      return;
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
        turn.toolCalls.push({ name, args, status: "pending", readOnly: false });
        awaitingConfirmation = true;
        continue;
      }

      emit({ type: "tool", name, args, status: "running" });
      const output = await tool.execute(args);
      emit({ type: "tool", name, args, status: "done", output });
      convo.push({ role: "tool", tool_call_id: call.id, content: output });
      turn.toolCalls.push({ name, args, output, status: "done", readOnly: true });

      await auditAiToolExecution(ctx.userId, {
        threadId: ctx.threadId,
        name,
        args,
        output,
        readOnly: true,
        confirmed: false,
        context: ctx.context,
      });
    }

    if (awaitingConfirmation) {
      const note =
        "\n\nThis action changes server state, so I need your confirmation before running it. " +
        "Approve it above to proceed.";
      turn.content += note;
      emit({ type: "text", delta: note });
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
    if (delta) {
      turn.content += delta;
      emit({ type: "text", delta });
    }
  }
}

async function runAnthropic(ctx: RunCtx) {
  const { apiKey, threadId, emit, turn, systemPrompt } = ctx;
  const anthropic = new Anthropic({ apiKey });
  const tools = getAnthropicToolSchemas();

  const history = await loadThreadMessages(threadId);
  const convo: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const stream = anthropic.messages.stream({
      model: resolveModel(),
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages: convo,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const delta = event.delta.text;
        if (delta) {
          turn.content += delta;
          emit({ type: "text", delta });
        }
      }
    }

    const finalMsg = await stream.finalMessage();
    if (finalMsg.usage) {
      turn.usage = {
        inputTokens: finalMsg.usage.input_tokens,
        outputTokens: finalMsg.usage.output_tokens,
      };
    }

    if (finalMsg.stop_reason !== "tool_use") return;

    const toolUses = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

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
        turn.toolCalls.push({ name, args, status: "pending", readOnly: false });
        awaitingConfirmation = true;
        continue;
      }

      emit({ type: "tool", name, args, status: "running" });
      const output = await tool.execute(args);
      emit({ type: "tool", name, args, status: "done", output });
      toolResults.push({ type: "tool_result", tool_use_id: use.id, content: output });
      turn.toolCalls.push({ name, args, output, status: "done", readOnly: true });

      await auditAiToolExecution(ctx.userId, {
        threadId: ctx.threadId,
        name,
        args,
        output,
        readOnly: true,
        confirmed: false,
        context: ctx.context,
      });
    }

    convo.push({ role: "user", content: toolResults });

    if (awaitingConfirmation) {
      const note =
        "\n\nThis action changes server state, so I need your confirmation before running it. " +
        "Approve it above to proceed.";
      turn.content += note;
      emit({ type: "text", delta: note });
      return;
    }
  }
}
