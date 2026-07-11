import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveAi } from "@/lib/ai-config";
import { getActiveVps, execOnVps, getSystemConfig, shQuote } from "@/lib/vps";
import { listManagedDeployments } from "@/lib/managed-deployments";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

/**
 * Deterministic GroundControl-aware intents so `/ai list deployments` never
 * falls back to a naive `docker ps` hallucination.
 */
function resolveDeterministicIntent(
  intent: string,
  managedRoot: string,
  projectRoot: string
): { mode: "command" | "help"; command?: string; explanation?: string; help?: string; suggestions?: string[] } | null {
  const q = intent.trim().toLowerCase().replace(/\s+/g, " ");

  // Managed deployments inventory
  if (
    /\b(list|show|ls|find|what|which)\b/.test(q) &&
    /\b(deployment|deployments|managed stack|managed stacks|stacks?)\b/.test(q)
  ) {
    return {
      mode: "command",
      command: `root=${shQuote(managedRoot)}; if [ ! -d "$root" ]; then echo "No managed root: $root"; exit 0; fi; echo "Managed root: $root"; echo ""; for d in "$root"/*; do [ -d "$d" ] || continue; name=$(basename "$d"); compose=""; for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do [ -f "$d/$f" ] && compose="$f" && break; done; if [ -n "$compose" ]; then printf '• %s\\n  path: %s\\n  compose: %s\\n' "$name" "$d" "$compose"; (cd "$d" && docker compose ps --format 'table {{.Name}}\\t{{.Status}}' 2>/dev/null | sed 's/^/  /' || true); echo ""; fi; done`,
      explanation: `List GroundControl managed deployments under ${managedRoot} (compose stacks), not raw docker ps.`,
    };
  }

  if (/\b(list|show|ls)\b/.test(q) && /\b(container|containers)\b/.test(q)) {
    return {
      mode: "command",
      command: `docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}'`,
      explanation: "List all Docker containers with status, image, and ports.",
    };
  }

  if (/\b(disk|df|space|storage)\b/.test(q) && /\b(use|usage|free|check|show|how)\b/.test(q)) {
    return {
      mode: "command",
      command: "df -h",
      explanation: "Filesystem disk usage.",
    };
  }

  if (/\b(memory|ram|mem)\b/.test(q) && /\b(use|usage|free|check|show|how)\b/.test(q)) {
    return {
      mode: "command",
      command: "free -h 2>/dev/null || cat /proc/meminfo | head -5",
      explanation: "Memory usage summary.",
    };
  }

  if (/\b(list|show|ls)\b/.test(q) && /\b(project|projects|apps?)\b/.test(q) && !/\bdeployment/.test(q)) {
    return {
      mode: "command",
      command: `ls -la ${shQuote(projectRoot)} 2>/dev/null || echo "No project root: ${projectRoot}"`,
      explanation: `List project directories under ${projectRoot}.`,
    };
  }

  // Inspect a named managed deployment: "inspect gc-tunnel-proof" / "show deployment foo"
  const inspectMatch = q.match(
    /(?:inspect|show|status of|status for|check)\s+(?:deployment\s+)?([a-z0-9][a-z0-9._-]*)/
  );
  if (inspectMatch && !/\b(disk|memory|container)\b/.test(q)) {
    const slug = inspectMatch[1];
    if (slug !== "deployment" && slug !== "deployments" && slug !== "all") {
      return {
        mode: "command",
        command: `d=${shQuote(`${managedRoot}/${slug}`)}; if [ ! -d "$d" ]; then echo "Not found: $d"; ls -1 ${shQuote(managedRoot)} 2>/dev/null; exit 0; fi; echo "=== $d ==="; ls -la "$d"; echo ""; (cd "$d" && docker compose ps -a 2>/dev/null || true); echo ""; (cd "$d" && docker compose config --services 2>/dev/null || true)`,
        explanation: `Inspect managed deployment "${slug}" under ${managedRoot}.`,
      };
    }
  }

  if (/\b(help|what can you|how do i)\b/.test(q) || q === "help") {
    return {
      mode: "help",
      help:
        "Terminal AI turns intent into a POSIX sh command on the active VPS. Prefer GroundControl paths for managed stacks.",
      suggestions: [
        "/ai list deployments",
        "/ai list containers",
        "/ai check disk space",
        "/ai inspect gc-tunnel-proof",
        "Open Co-Pilot for multi-step mutating actions with confirmation",
      ],
    };
  }

  return null;
}

async function getServerContext(): Promise<{ text: string; managedRoot: string; projectRoot: string }> {
  let managedRoot = "/srv/groundcontrol/deployments";
  let projectRoot = "/opt";
  try {
    const config = await getSystemConfig();
    managedRoot = (config.templateDeploymentRoot || managedRoot).replace(/\/+$/, "");
    projectRoot = (config.projectRoot || projectRoot).replace(/\/+$/, "");
  } catch {
    // defaults
  }

  try {
    const vps = await getActiveVps();
    if (!vps) {
      return { text: "No VPS connected.", managedRoot, projectRoot };
    }

    const [hostname, os, docker, dockerPs, managed] = await Promise.all([
      execOnVps("hostname 2>/dev/null || echo unknown", vps),
      execOnVps("cat /etc/os-release 2>/dev/null | head -4 || uname -a", vps),
      execOnVps("docker --version 2>/dev/null || echo 'no docker'", vps),
      execOnVps(
        "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}' 2>/dev/null | head -20 || echo 'no containers'",
        vps
      ),
      listManagedDeployments(vps).catch(() => ({ root: managedRoot, deployments: [] as { slug: string; path: string }[] })),
    ]);

    const deployLines =
      managed.deployments.length > 0
        ? managed.deployments.map((d) => `- ${d.slug} → ${d.path}`).join("\n")
        : `(none under ${managed.root || managedRoot})`;

    return {
      managedRoot: managed.root || managedRoot,
      projectRoot,
      text: `Server: ${hostname.stdout.trim()}
OS: ${os.stdout.trim().replace(/\n/g, " ").slice(0, 200)}
Docker: ${docker.stdout.trim()}
Project root: ${projectRoot}
Managed deployment root: ${managed.root || managedRoot}
Managed deployments (GroundControl stacks):
${deployLines}
Running containers:
${dockerPs.stdout.trim().slice(0, 800)}

IMPORTANT:
- "deployments" / "managed stacks" means directories under the managed root with docker-compose files.
- Do NOT substitute docker ps for "list deployments".
- Prefer POSIX sh. Prefer cd into the stack dir and docker compose … over inventing -p project names.`,
    };
  } catch {
    return { text: "Could not fetch server context.", managedRoot, projectRoot };
  }
}

const SYSTEM_PROMPT = `You are the GroundControl terminal AI. You convert operator intent into a single safe POSIX sh command for the active VPS, or short help.

**MODE command** — JSON: {"mode":"command","command":"...","explanation":"..."}
**MODE help** — JSON: {"mode":"help","help":"...","suggestions":["..."]}

RULES:
1. GroundControl has MANAGED DEPLOYMENTS under templateDeploymentRoot (usually /srv/groundcontrol/deployments). Each child dir with docker-compose.yml is a deployment (e.g. gc-tunnel-proof).
2. When the user asks to list/show deployments or stacks, list that managed root — NEVER only docker ps.
3. When they name a slug, inspect that path: ls + docker compose ps in that directory.
4. Project apps may also live under projectRoot (often /opt) — distinguish projects vs managed deployments.
5. Commands must be POSIX sh / BusyBox compatible (no bashisms). Single line with && or ; if needed.
6. Prefer docker compose (plugin) over docker-compose. Run from the deployment directory.
7. Do not invent compose project names with -p.
8. If unsure, use help mode and suggest /ai list deployments or Co-Pilot for mutating multi-step work.

EXAMPLES:
User: "list all deployments" → command that lists managed root slugs and compose status
User: "list containers" → docker ps -a --format ...
User: "disk space" → df -h
User: "inspect gc-company-site" → cd managed/gc-company-site && docker compose ps -a`;

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { intent, cwd } = await req.json();
    if (!intent || typeof intent !== "string") {
      return NextResponse.json({ error: "intent required" }, { status: 400 });
    }

    const ctx = await getServerContext();
    const deterministic = resolveDeterministicIntent(intent, ctx.managedRoot, ctx.projectRoot);
    if (deterministic) {
      return NextResponse.json(deterministic);
    }

    const { provider, apiKey, model } = getActiveAi();
    if (!apiKey) {
      const label = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      return NextResponse.json(
        { error: `${label} not configured. Add it in Settings → AI.` },
        { status: 503 }
      );
    }

    const userPrompt = `Server context:\n${ctx.text}\n\nWorking directory: ${cwd || "/"}\nUser intent: ${intent}\n\nRespond with JSON only: {"mode":"command"|"help","command"?:"...","explanation"?:"...","help"?:"...","suggestions"?:[...]}`;

    let result: {
      mode?: string;
      command?: string;
      explanation?: string;
      help?: string;
      suggestions?: string[];
    };

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
        temperature: 0.2,
      });
      const text = response.choices[0]?.message?.content || "";
      result = parseJsonResponse(text);
    }

    // Guardrail: if user said "deployment" but model returned bare docker ps, override
    if (
      result.command &&
      /\bdeployment/.test(intent.toLowerCase()) &&
      /^\s*docker\s+ps\b/i.test(result.command)
    ) {
      const fallback = resolveDeterministicIntent("list deployments", ctx.managedRoot, ctx.projectRoot);
      if (fallback) return NextResponse.json(fallback);
    }

    if (result.command) {
      result.command = result.command.replace(/\n/g, " ").trim().replace(/`+$/g, "").trim();
      result.mode = result.mode || "command";
    } else {
      result.mode = result.mode || "help";
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseJsonResponse(text: string): {
  mode?: string;
  command?: string;
  explanation?: string;
  help?: string;
  suggestions?: string[];
} {
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fence ? fence[1] : text;
    return JSON.parse(raw);
  } catch {
    const cmdMatch = text.match(/"command"\s*:\s*"([^"]*)"/);
    return {
      mode: "help",
      help: text.slice(0, 500),
      command: cmdMatch ? cmdMatch[1] : undefined,
    };
  }
}
