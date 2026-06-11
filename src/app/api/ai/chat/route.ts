import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getOpenAIKey } from "@/lib/ai-config";
import { getTool, getOpenAIToolSchemas, isReadOnlyTool } from "@/lib/ai-agent";
import OpenAI from "openai";

// Always run at request time — this handler streams and hits the VPS.
export const dynamic = "force-dynamic";

/**
 * Default model. Configurable via the AI_MODEL env var so operators can pin a
 * different OpenAI model without code changes. gpt-4o is a strong, current,
 * tool-calling-capable default (a real upgrade over the old gpt-4o-mini).
 */
const DEFAULT_MODEL = process.env.AI_MODEL || "gpt-4o";

const MAX_TOOL_ITERATIONS = 6;

function getOpenAI() {
  return new OpenAI({ apiKey: getOpenAIKey() });
}

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
  `container_stats, container_logs, list_projects, disk_usage, read_proxy_config). Use run_diagnostic ` +
  `only for read-only inspection that no dedicated tool covers.\n` +
  `- Chain tools as needed: e.g. to find which service uses the most memory, call top_memory_processes ` +
  `and/or container_stats, then summarize.\n` +
  `- Be honest about limits: destructive/mutating actions (restart/start/stop containers) require ` +
  `explicit user confirmation in the UI — you cannot perform them silently. Propose them, but the user ` +
  `must approve before they run.\n` +
  `- If a tool returns an error (e.g. the VPS is unreachable), say so plainly and suggest next steps; ` +
  `do not invent results.\n\n` +
  `Be concise and practical. Assume a Linux VPS (could be Debian/Ubuntu or Alpine/BusyBox). When useful, ` +
  `reference GroundControl dashboard pages (Topology, XRay, Terminal, Alerts, Sites, Projects). Format ` +
  `answers in clean Markdown.`;

type WireMessage = { role: string; content: string };

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
      confirmedTool?: { name: string; args: Record<string, any> };
    };
    const { messages, confirmedTool } = body;

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

    const openai = getOpenAI();
    const toolSchemas = getOpenAIToolSchemas();

    // Map inbound history into OpenAI message params (keep only user/assistant turns).
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
    ];

    const readable = new ReadableStream({
      async start(controller) {
        const emit = (obj: unknown) => controller.enqueue(sse(obj));
        try {
          // -------------------------------------------------------------
          // 0. Confirmed mutating tool path: the user approved a mutation.
          //    Execute it, append the observation, then let the model
          //    continue the loop to report the outcome.
          // -------------------------------------------------------------
          if (confirmedTool?.name) {
            const tool = getTool(confirmedTool.name);
            if (!tool) {
              emit({ type: "tool", name: confirmedTool.name, status: "error", output: "Unknown tool." });
            } else {
              const cArgs = confirmedTool.args || {};
              emit({ type: "tool", name: tool.name, args: cArgs, status: "running" });
              const output = await tool.execute(cArgs);
              emit({ type: "tool", name: tool.name, args: cArgs, status: "done", output });
              // Seed the conversation so the model knows the action was taken.
              convo.push({
                role: "assistant",
                content: `I executed the confirmed action \`${tool.name}\` with arguments ${JSON.stringify(
                  cArgs
                )}.`,
              });
              convo.push({
                role: "user",
                content: `Result of ${tool.name}:\n\n${output}\n\nPlease summarize the outcome.`,
              });
            }
          }

          // -------------------------------------------------------------
          // 1. Tool-calling loop.
          // -------------------------------------------------------------
          for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
            const completion = await openai.chat.completions.create({
              model: DEFAULT_MODEL,
              messages: convo,
              tools: toolSchemas,
              tool_choice: "auto",
              temperature: 0.4,
            });

            const choice = completion.choices[0];
            const msg = choice?.message;
            const toolCalls = msg?.tool_calls || [];

            // No tool calls -> the model is ready to answer.
            if (!toolCalls.length) {
              if (msg?.content) {
                emit({ type: "text", delta: msg.content });
                controller.close();
                return;
              }
              break;
            }

            // Record the assistant turn that requested the tools.
            convo.push(msg as OpenAI.Chat.ChatCompletionMessageParam);

            let awaitingConfirmation = false;

            for (const call of toolCalls) {
              if (call.type !== "function") continue;
              const name = call.function.name;
              let args: Record<string, any> = {};
              try {
                args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
              } catch {
                args = {};
              }

              const tool = getTool(name);

              if (!tool) {
                convo.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content: `ERROR: unknown tool "${name}".`,
                });
                continue;
              }

              // Mutating tool -> do NOT execute. Surface a confirmation request
              // to the UI and stop; the user must approve via a fresh request.
              if (!isReadOnlyTool(name)) {
                emit({
                  type: "confirm",
                  name,
                  args,
                  description: tool.description,
                });
                // Satisfy the tool_call so the conversation stays valid.
                convo.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content:
                    `This is a mutating action and was NOT executed. It is pending explicit user ` +
                    `confirmation in the UI.`,
                });
                awaitingConfirmation = true;
                continue;
              }

              // Read-only tool -> auto-run.
              emit({ type: "tool", name, args, status: "running" });
              const output = await tool.execute(args);
              emit({ type: "tool", name, args, status: "done", output });
              convo.push({
                role: "tool",
                tool_call_id: call.id,
                content: output,
              });
            }

            if (awaitingConfirmation) {
              // Stop here — wait for the user to approve. The UI re-calls with
              // `confirmedTool` set once they click Approve.
              emit({
                type: "text",
                delta:
                  "\n\nThis action changes server state, so I need your confirmation before running it. " +
                  "Approve it above to proceed.",
              });
              controller.close();
              return;
            }
            // Otherwise loop again with the tool observations appended.
          }

          // -------------------------------------------------------------
          // 2. Final streamed answer (after tool loop or iteration cap).
          // -------------------------------------------------------------
          const finalStream = await openai.chat.completions.create({
            model: DEFAULT_MODEL,
            messages: convo,
            stream: true,
            temperature: 0.4,
          });

          for await (const chunk of finalStream) {
            const delta = chunk.choices[0]?.delta?.content || "";
            if (delta) emit({ type: "text", delta });
          }
          controller.close();
        } catch (err: any) {
          try {
            emit({ type: "error", error: err?.message || "AI request failed" });
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
  } catch (err: any) {
    const msg = err?.message || "AI request failed";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
