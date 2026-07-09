import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveAi } from "@/lib/ai-config";
import { getActiveVps, execOnVps } from "@/lib/vps";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

async function getServerContext(): Promise<string> {
  try {
    const vps = await getActiveVps();
    if (!vps) return "No VPS connected.";
    const [hostname, os, docker, dockerPs] = await Promise.all([
      execOnVps("hostname 2>/dev/null || echo unknown", vps),
      execOnVps("cat /etc/os-release 2>/dev/null | head -4 || uname -a", vps),
      execOnVps("docker --version 2>/dev/null || echo 'no docker'", vps),
      execOnVps("docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | head -20 || echo 'no containers'", vps),
    ]);
    return `Server: ${hostname.stdout.trim()}
OS: ${os.stdout.trim().replace(/\n/g, " ").slice(0, 200)}
Docker: ${docker.stdout.trim()}
Running containers:
${dockerPs.stdout.trim().slice(0, 800)}`;
  } catch {
    return "Could not fetch server context.";
  }
}

const SYSTEM_PROMPT = `You are the GroundControl terminal AI assistant, embedded in a VPS management tool. You have two modes:

**MODE 1 — COMMAND**: If the user wants to RUN something (check memory, list files, kill a process, etc.), respond with JSON: {"command": "...", "explanation": "..."}
The command must be POSIX sh (BusyBox) — no bashisms. Single line, use && or ; for chaining.

**MODE 2 — HELP**: If the user is asking a question, stuck on a tutorial, wants to understand something, or needs troubleshooting advice, respond with JSON: {"help": "...", "suggestions": ["next step", "alternative approach", ...]}
Give clear, actionable advice. If you know what containers or services are running on the server, reference them. If a command might help, include it.

**DEFAULT**: If unsure, use MODE 2 (HELP) — it's better to explain than to guess a wrong command.

**SERVER CONTEXT** (provided with each request):
The user's server state will be included. Use it to give relevant, specific advice.

**EXAMPLES**:
User: "check disk space" → {"command": "df -h", "explanation": "Shows disk usage for all mounted filesystems."}
User: "nginx config help" → {"help": "To set up an nginx reverse proxy, create a config in /etc/nginx/sites-available/, symlink to sites-enabled, test with nginx -t, and reload with systemctl reload nginx.", "suggestions": ["Create config: nano /etc/nginx/sites-available/myapp", "Test: nginx -t", "Reload: systemctl reload nginx"]}
User: "I'm following an nginx cluster tutorial and got stuck at configuring upstream" → {"help": "For an nginx upstream cluster, define your backend servers in the upstream block. Here's a template...", "suggestions": [...], "command": "cat > /etc/nginx/sites-available/cluster.conf << 'EOF'\n..."}  (you can provide both help AND an optional command)`;

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { intent, cwd } = await req.json();
    if (!intent || typeof intent !== "string") {
      return NextResponse.json({ error: "intent required" }, { status: 400 });
    }

    const { provider, apiKey, model } = getActiveAi();
    if (!apiKey) {
      const label = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      return NextResponse.json({ error: `${label} not configured. Add it in Settings → AI.` }, { status: 503 });
    }

    const serverCtx = await getServerContext();
    const userPrompt = `Server context:\n${serverCtx}\n\nWorking directory: ${cwd || "/"}\nUser intent: ${intent}\n\nRespond with JSON: {"mode": "command"|"help", "command"?: "...", "explanation"?: "...", "help"?: "...", "suggestions"?: [...]}`;

    let result: { mode?: string; command?: string; explanation?: string; help?: string; suggestions?: string[] };

    if (provider === "anthropic") {
      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      result = parseJsonResponse(text);
    } else {
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      });
      const text = response.choices[0]?.message?.content || "";
      result = parseJsonResponse(text);
    }

    if (result.command) {
      result.command = result.command.replace(/\n/g, " ").trim().replace(/`+$/g, "").trim();
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseJsonResponse(text: string): any {
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fence ? fence[1] : text;
    return JSON.parse(raw);
  } catch {
    const cmdMatch = text.match(/"command"\s*:\s*"([^"]*)"/);
    return { mode: "help", help: text.slice(0, 500), command: cmdMatch ? cmdMatch[1] : undefined };
  }
}
