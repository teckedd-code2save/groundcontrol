import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execOnVps, getDockerContainers, getSystemConfig, shQuote } from "@/lib/vps";

const COMMON_COMMANDS = [
  "docker ps",
  "docker ps -a",
  "docker stats",
  "docker images",
  "docker logs ",
  "docker exec ",
  "docker compose ps",
  "docker compose up -d",
  "docker compose down",
  "docker compose logs ",
  "df -h",
  "free -m",
  "ps aux",
  "ps -ef",
  "top",
  "uptime",
  "uname -a",
  "systemctl status ",
  "systemctl list-units",
  "journalctl -u ",
  "caddy reload",
  "caddy validate",
  "nginx -t",
  "nginx -s reload",
  "ls -la",
  "cat ",
  "cd ",
  "pwd",
  "find . -name ",
  "grep -r ",
];

interface Suggestion {
  value: string;
  label: string;
  type: "command" | "file" | "container" | "project" | "history";
}

function normalizeInput(input: string): { command: string; prefix: string; word: string } {
  const trimmed = input.trimStart();
  // If the line starts with a known command, autocomplete the argument.
  const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s+(.*)$/);
  if (!match) {
    return { command: "", prefix: "", word: trimmed };
  }
  return { command: match[1], prefix: match[0], word: match[2] };
}

async function completePaths(cwd: string, word: string): Promise<Suggestion[]> {
  const suggestions: Suggestion[] = [];
  const dir = word.includes("/")
    ? word.slice(0, word.lastIndexOf("/") + 1)
    : "";
  const base = word.includes("/") ? word.slice(word.lastIndexOf("/") + 1) : word;
  const targetDir = dir.startsWith("/")
    ? dir
    : dir
    ? `${cwd === "/" ? "" : cwd}/${dir}`
    : cwd;

  try {
    const result = await execOnVps(
      `ls -1ap ${shQuote(targetDir)} 2>/dev/null || echo ""`,
    );
    const entries = result.stdout
      .split("\n")
      .map((e) => e.trim())
      .filter((e) => e && e !== "./" && e !== "../" && e.startsWith(base));
    for (const entry of entries) {
      const value = dir + entry;
      suggestions.push({
        value,
        label: value,
        type: entry.endsWith("/") ? "file" : "file",
      });
    }
  } catch {
    // ignore
  }
  return suggestions;
}

async function completeContainers(word: string): Promise<Suggestion[]> {
  try {
    const containers = await getDockerContainers();
    return containers
      .filter((c) => c.name.toLowerCase().startsWith(word.toLowerCase()))
      .map((c) => ({
        value: c.name,
        label: `${c.name} (${c.state})`,
        type: "container" as const,
      }));
  } catch {
    return [];
  }
}

async function completeProjects(word: string): Promise<Suggestion[]> {
  try {
    const config = await getSystemConfig();
    const root = config.projectRoot || "/opt";
    const result = await execOnVps(
      `ls -1 ${shQuote(root)} 2>/dev/null || echo ""`,
    );
    return result.stdout
      .split("\n")
      .map((d) => d.trim())
      .filter((d) => d && d.toLowerCase().startsWith(word.toLowerCase()))
      .map((d) => ({ value: d, label: `${d}/`, type: "project" as const }));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { input, cwd, history = [] } = await req.json();
    if (typeof input !== "string") {
      return NextResponse.json({ error: "input required" }, { status: 400 });
    }

    const { command, word } = normalizeInput(input);
    const suggestions: Suggestion[] = [];

    // First word: commands + history.
    if (!command) {
      for (const cmd of COMMON_COMMANDS) {
        if (cmd.toLowerCase().startsWith(word.toLowerCase())) {
          suggestions.push({ value: cmd, label: cmd, type: "command" });
        }
      }
      for (const h of history.slice().reverse()) {
        if (typeof h === "string" && h.toLowerCase().startsWith(word.toLowerCase())) {
          suggestions.push({ value: h, label: h, type: "history" });
        }
      }
    }

    // Container-aware commands.
    const containerCommands = ["docker logs", "docker exec", "docker restart", "docker stop", "docker start", "docker rm"];
    if (containerCommands.some((c) => input.trimStart().toLowerCase().startsWith(c))) {
      suggestions.push(...(await completeContainers(word)));
    }

    // Project-aware commands.
    const projectCommands = ["cd", "ls", "cat", "docker compose -f", "docker compose"];
    if (projectCommands.some((c) => input.trimStart().toLowerCase().startsWith(c + " "))) {
      suggestions.push(...(await completeProjects(word)));
    }

    // Path completion for any command with a word argument.
    if (command && word) {
      suggestions.push(...(await completePaths(cwd || "/", word)));
    }

    // Deduplicate by value, preferring non-history entries.
    const seen = new Set<string>();
    const deduped: Suggestion[] = [];
    for (const s of suggestions) {
      if (seen.has(s.value)) continue;
      seen.add(s.value);
      deduped.push(s);
    }

    return NextResponse.json({ suggestions: deduped.slice(0, 20) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
