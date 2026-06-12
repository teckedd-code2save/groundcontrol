import {
  execOnVps,
  getSystemStats,
  getDockerContainers,
  getDockerStats,
  getContainerLogs,
  getSystemConfig,
  shQuote,
} from "@/lib/vps";
import { prisma } from "@/lib/prisma";

/**
 * GroundControl AI agent tool set.
 *
 * Each tool wraps a read-only (or explicitly confirmed mutating) operation on
 * the active VPS via `execOnVps`. Tools are intentionally portable across
 * sh/BusyBox shells (no bash-isms, graceful fallbacks) and degrade gracefully
 * when the VPS is unreachable — every `execute` catches errors and returns a
 * readable string rather than throwing, so the model always gets a usable
 * observation.
 */

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Read-only tools auto-run. Mutating tools require explicit user confirmation. */
  readOnly: boolean;
  execute: (args: Record<string, any>) => Promise<string>;
}

/** Safe wrapper: run a command, never throw, surface stderr/exit code clearly. */
async function safeExec(command: string): Promise<string> {
  try {
    const { stdout, stderr, code } = await execOnVps(command);
    const out = (stdout || "").trim();
    const err = (stderr || "").trim();
    if (out) {
      // Include stderr only if it carries extra signal alongside output.
      return err ? `${out}\n[stderr] ${err}` : out;
    }
    if (err) return `[exit ${code}] ${err}`;
    return code === 0 ? "(no output)" : `[exit ${code}] (no output)`;
  } catch (err: unknown) {
    return `ERROR: could not reach the VPS or run the command: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Run a tool body that may throw, returning a readable error string instead. */
async function guard(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (err: unknown) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// run_diagnostic guard rails
// ---------------------------------------------------------------------------

/**
 * Patterns that are NEVER allowed through `run_diagnostic`. This is a
 * conservative deny-list focused on destructive / mutating / exfiltration
 * primitives. `run_diagnostic` is meant for ad-hoc *read-only* inspection only.
 */
const DANGEROUS_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\b/, reason: "file deletion (rm)" },
  { re: /\brmdir\b/, reason: "directory deletion (rmdir)" },
  { re: /\bdd\b/, reason: "raw disk write (dd)" },
  { re: /\bmkfs\b/, reason: "filesystem creation (mkfs)" },
  { re: /\bfdisk\b/, reason: "partitioning (fdisk)" },
  { re: /\bshutdown\b/, reason: "shutdown" },
  { re: /\breboot\b/, reason: "reboot" },
  { re: /\bhalt\b/, reason: "halt" },
  { re: /\bpoweroff\b/, reason: "poweroff" },
  { re: /\binit\s+0\b/, reason: "init 0/6" },
  { re: /\bmv\b/, reason: "moving/renaming files (mv)" },
  { re: /\bcp\b/, reason: "copying files (cp)" },
  { re: /\bchmod\b/, reason: "permission change (chmod)" },
  { re: /\bchown\b/, reason: "ownership change (chown)" },
  { re: /\bkill(all)?\b/, reason: "killing processes (kill)" },
  { re: /\bpkill\b/, reason: "killing processes (pkill)" },
  { re: /\bmount\b/, reason: "mount" },
  { re: /\bumount\b/, reason: "umount" },
  { re: /\bsystemctl\s+(start|stop|restart|disable|enable|mask)\b/, reason: "service control" },
  { re: /\bservice\s+\S+\s+(start|stop|restart)\b/, reason: "service control" },
  { re: /\bdocker\s+(rm|rmi|stop|start|restart|kill|run|exec|build|pull|push|prune|compose)\b/, reason: "docker mutation" },
  { re: /\b(apt|apt-get|yum|dnf|apk|pacman)\b/, reason: "package management" },
  { re: /\b(useradd|userdel|usermod|passwd|groupadd)\b/, reason: "user/account management" },
  { re: /\bcrontab\b/, reason: "cron modification" },
  { re: /\biptables\b/, reason: "firewall modification" },
  { re: /\bnft\b/, reason: "firewall modification (nftables)" },
  { re: /\bufw\b/, reason: "firewall modification (ufw)" },
  { re: /:\s*\(\s*\)\s*\{/, reason: "fork bomb" },
  { re: /:\|:/, reason: "fork bomb" },
  { re: />/, reason: "output redirection / file writing (>)" },
  { re: /\btee\b/, reason: "file writing (tee)" },
  { re: /\btruncate\b/, reason: "file truncation" },
  { re: /\bln\b/, reason: "link creation (ln)" },
  { re: /\bcurl\b[\s\S]*\|[\s\S]*\b(sh|bash)\b/, reason: "curl|sh remote execution" },
  { re: /\bwget\b[\s\S]*\|[\s\S]*\b(sh|bash)\b/, reason: "wget|sh remote execution" },
  { re: /\beval\b/, reason: "eval" },
  { re: /\bsudo\b/, reason: "privilege escalation (sudo)" },
  { re: /\bsu\b\s/, reason: "user switching (su)" },
  { re: /\bnc\b|\bnetcat\b|\bncat\b/, reason: "network shells (netcat)" },
  { re: /\bset\b\s+[+-][a-zA-Z]/, reason: "shell option mutation" },
  { re: /\bexport\b\s+\w+=/, reason: "environment mutation" },
  { re: /\bsysctl\s+-w\b/, reason: "kernel param write" },
  { re: /\bgit\s+(push|reset|clean|checkout|rebase|commit)\b/, reason: "git mutation" },
];

/** Commands we positively trust as read-only inspection primitives. */
const SAFE_COMMAND_HEADS = new Set([
  "cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "zgrep",
  "ls", "dir", "stat", "file", "find", "wc", "sort", "uniq", "cut", "awk",
  "sed", "tr", "echo", "printf", "df", "du", "free", "uptime", "uname",
  "hostname", "whoami", "id", "ps", "top", "vmstat", "iostat", "mpstat",
  "netstat", "ss", "ip", "ifconfig", "ping", "dig", "nslookup", "host",
  "docker", "systemctl", "journalctl", "date", "env", "printenv", "which",
  "command", "type", "lsof", "lsblk", "lscpu", "lsusb", "lspci",
  "tac", "nl", "basename", "dirname", "realpath", "readlink", "test",
  "true", "false", "pwd", "getent", "nproc", "tty", "w", "last",
]);

/**
 * Validate a `run_diagnostic` command. Returns null if allowed, otherwise a
 * human-readable refusal reason.
 */
export function checkDiagnosticCommand(command: string): string | null {
  const cmd = (command || "").trim();
  if (!cmd) return "Empty command.";

  // Deny dangerous patterns first.
  for (const { re, reason } of DANGEROUS_PATTERNS) {
    if (re.test(cmd)) {
      return `Refused: command appears to perform a disallowed/destructive operation (${reason}). ` +
        `run_diagnostic only permits safe, read-only inspection commands.`;
    }
  }

  // `systemctl`/`docker` are in SAFE_COMMAND_HEADS but their mutating
  // subcommands are already blocked by DANGEROUS_PATTERNS above, so what
  // remains (status/list/inspect/logs/ps) is read-only.

  // Inspect each command segment (split on ; && || |) and ensure the leading
  // token is a known read-only utility.
  const segments = cmd.split(/(?:\|\||&&|[;|])/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    // Take the first token; strip any leading path so /usr/bin/ps -> ps.
    const head = trimmed.split(/\s+/)[0].replace(/^.*\//, "");
    if (!SAFE_COMMAND_HEADS.has(head)) {
      return `Refused: "${head}" is not in the read-only allow-list. ` +
        `run_diagnostic only permits inspection commands (cat, ls, grep, ps, df, docker ps/stats/logs, systemctl status, journalctl, etc.).`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "system_stats",
    description:
      "Get a snapshot of overall server health: CPU core count and load average, memory used/total/free (MB), and disk usage of the root filesystem. Use this first when asked about general server load or resource pressure.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const s = await getSystemStats();
        return JSON.stringify(s, null, 2);
      }),
  },
  {
    name: "top_memory_processes",
    description:
      "List the processes consuming the most memory (RSS / %MEM). Use this to answer 'which service/process is using the most memory'. Portable across BusyBox/Alpine and full Linux.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "How many processes to return (default 15).", default: 15 },
      },
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const n = Math.max(1, Math.min(50, Number(args?.limit) || 15));
        // Try GNU ps with --sort; fall back to plain ps + sort for BusyBox.
        const cmd =
          `ps -eo pid,comm,%mem,%cpu,rss --sort=-%mem 2>/dev/null | head -n ${n + 1} ` +
          `|| ps -eo pid,comm,%mem,%cpu,rss 2>/dev/null | sort -k3 -nr | head -n ${n} ` +
          `|| ps aux 2>/dev/null | sort -k4 -nr | head -n ${n}`;
        return safeExec(cmd);
      }),
  },
  {
    name: "top_cpu_processes",
    description:
      "List the processes consuming the most CPU (%CPU). Use this to answer 'which service/process is using the most CPU'. Portable across BusyBox/Alpine and full Linux.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "How many processes to return (default 15).", default: 15 },
      },
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const n = Math.max(1, Math.min(50, Number(args?.limit) || 15));
        const cmd =
          `ps -eo pid,comm,%cpu,%mem --sort=-%cpu 2>/dev/null | head -n ${n + 1} ` +
          `|| ps -eo pid,comm,%cpu,%mem 2>/dev/null | sort -k3 -nr | head -n ${n} ` +
          `|| ps aux 2>/dev/null | sort -k3 -nr | head -n ${n}`;
        return safeExec(cmd);
      }),
  },
  {
    name: "list_containers",
    description:
      "List all Docker containers (running and stopped) with name, image, status, ports and state. Use to see what services are deployed.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const containers = await getDockerContainers();
        if (!containers.length) return "No Docker containers found (or Docker is not running).";
        return JSON.stringify(containers, null, 2);
      }),
  },
  {
    name: "container_stats",
    description:
      "Live resource usage per running Docker container (CPU %, memory usage, network I/O, block I/O, PIDs) via `docker stats --no-stream`. Use to compare per-container memory/CPU.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const stats = await getDockerStats();
        if (!stats.length) return "No running containers to report stats for.";
        return JSON.stringify(stats, null, 2);
      }),
  },
  {
    name: "container_logs",
    description:
      "Fetch the tail of a specific Docker container's logs (stdout+stderr). Use to debug a misbehaving service.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Container name (as shown by list_containers)." },
        tail: { type: "integer", description: "Number of trailing log lines (default 100, max 5000).", default: 100 },
      },
      required: ["name"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const name = String(args?.name || "").trim();
        if (!name) return "ERROR: container name is required.";
        const tail = Math.max(1, Math.min(5000, Number(args?.tail) || 100));
        const logs = await getContainerLogs(name, tail);
        return logs?.trim() ? logs : "(no log output)";
      }),
  },
  {
    name: "list_projects",
    description:
      "List the project directories under the configured project root (e.g. /opt). These are the deployed apps/stacks on the server.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const config = await getSystemConfig();
        const root = config.projectRoot || "/opt";
        return safeExec(
          `ls -1 ${shQuote(root)} 2>/dev/null || find ${shQuote(root)} -mindepth 1 -maxdepth 1 -type d 2>/dev/null`
        );
      }),
  },
  {
    name: "disk_usage",
    description:
      "Report filesystem disk usage (`df -h`) and the size of each child directory of the project root (`du -sh`). Use to find what is filling the disk.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const config = await getSystemConfig();
        const root = config.projectRoot || "/opt";
        const df = await safeExec("df -h");
        const du = await safeExec(
          `du -sh ${shQuote(root)}/* 2>/dev/null | sort -hr | head -n 30`
        );
        return `# df -h\n${df}\n\n# du -sh ${root}/*\n${du}`;
      }),
  },
  {
    name: "read_proxy_config",
    description:
      "Read the reverse-proxy configuration (Caddy site files / Caddyfile, or Nginx sites). Use to inspect routing, domains and reverse_proxy targets.",
    parameters: {
      type: "object",
      properties: {
        proxy: {
          type: "string",
          enum: ["caddy", "nginx"],
          description: "Which proxy's config to read (default caddy).",
          default: "caddy",
        },
      },
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const config = await getSystemConfig();
        const proxy = (args?.proxy === "nginx" ? "nginx" : "caddy") as "caddy" | "nginx";
        if (proxy === "nginx") {
          const dir = config.nginxSitesDir || "/etc/nginx/sites-available";
          return safeExec(
            `for f in ${shQuote(dir)}/*; do [ -f "$f" ] && echo "===== $f =====" && cat "$f"; done 2>/dev/null || echo "(no nginx site files found in ${dir})"`
          );
        }
        const dir = config.caddySitesDir || "/etc/caddy/sites";
        const file = config.caddyFile || "/etc/caddy/Caddyfile";
        return safeExec(
          `for f in ${shQuote(dir)}/*; do [ -f "$f" ] && echo "===== $f =====" && cat "$f"; done 2>/dev/null; ` +
          `[ -f ${shQuote(file)} ] && echo "===== ${file} =====" && cat ${shQuote(file)} 2>/dev/null; ` +
          `true`
        );
      }),
  },
  {
    name: "run_diagnostic",
    description:
      "Escape hatch to run an arbitrary READ-ONLY shell command on the server for diagnostics. Only safe inspection commands are permitted (cat, ls, grep, ps, df, du, free, docker ps/stats/logs, systemctl status, journalctl, ss, etc.). Anything that writes, deletes, mutates state, escalates privilege, or fetches+executes remote code is refused. Prefer the dedicated tools when one fits.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The read-only shell command to run." },
      },
      required: ["command"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const command = String(args?.command || "");
        const refusal = checkDiagnosticCommand(command);
        if (refusal) return refusal;
        return safeExec(command);
      }),
  },
  {
    name: "synthesize_alerts",
    description:
      "Synthesize recent alerts, metrics, container state, and top processes into a concise operational summary with root-cause hypotheses and recommended actions. Read-only.",
    parameters: {
      type: "object",
      properties: {
        alertLimit: { type: "integer", description: "How many recent alerts to consider (default 10).", default: 10 },
        metricLimit: { type: "integer", description: "How many recent metric snapshots to consider (default 20).", default: 20 },
      },
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const alertLimit = Math.max(1, Math.min(50, Number(args?.alertLimit) || 10));
        const metricLimit = Math.max(1, Math.min(100, Number(args?.metricLimit) || 20));

        const [alerts, metrics, containers] = await Promise.all([
          prisma.alert.findMany({ orderBy: { createdAt: "desc" }, take: alertLimit }),
          prisma.metricSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: metricLimit }),
          getDockerContainers(),
        ]);

        const topMemCmd =
          `ps -eo pid,comm,%mem,%cpu,rss --sort=-%mem 2>/dev/null | head -n 11 ` +
          `|| ps -eo pid,comm,%mem,%cpu,rss 2>/dev/null | sort -k3 -nr | head -n 10 ` +
          `|| ps aux 2>/dev/null | sort -k4 -nr | head -n 10`;
        const topCpuCmd =
          `ps -eo pid,comm,%cpu,%mem --sort=-%cpu 2>/dev/null | head -n 11 ` +
          `|| ps -eo pid,comm,%cpu,%mem 2>/dev/null | sort -k3 -nr | head -n 10 ` +
          `|| ps aux 2>/dev/null | sort -k3 -nr | head -n 10`;
        const [topMem, topCpu] = await Promise.all([safeExec(topMemCmd), safeExec(topCpuCmd)]);

        const unhealthy = containers.filter((c) => c.status.includes("unhealthy"));
        const stopped = containers.filter((c) => c.state !== "running");

        return JSON.stringify(
          {
            alerts: alerts.map((a) => ({ title: a.title, severity: a.severity, message: a.message, read: a.read, createdAt: a.createdAt })),
            metricsSummary: metrics.length
              ? {
                  latest: metrics[0],
                  avgMemPercent: metrics.reduce((s, m) => s + m.memPercent, 0) / metrics.length,
                  avgDiskPercent: metrics.reduce((s, m) => s + m.diskPercent, 0) / metrics.length,
                  avgCpuLoad1: metrics.reduce((s, m) => s + m.cpuLoad1, 0) / metrics.length,
                  maxUnhealthyContainers: Math.max(...metrics.map((m) => m.unhealthyContainers)),
                }
              : null,
            containers: { total: containers.length, running: containers.filter((c) => c.state === "running").length, unhealthy: unhealthy.length, stopped: stopped.length, names: containers.map((c) => c.name) },
            topMemoryProcesses: topMem,
            topCpuProcesses: topCpu,
          },
          null,
          2
        );
      }),
  },
  // --- Mutating tools: never auto-execute. Require explicit confirmation. ----
  {
    name: "restart_container",
    description:
      "Restart a Docker container. MUTATING — requires explicit user confirmation before it runs.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Container name." } },
      required: ["name"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const name = String(args?.name || "").trim();
        if (!name) return "ERROR: container name is required.";
        return safeExec(`docker restart ${shQuote(name)}`);
      }),
  },
  {
    name: "start_container",
    description:
      "Start a stopped Docker container. MUTATING — requires explicit user confirmation before it runs.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Container name." } },
      required: ["name"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const name = String(args?.name || "").trim();
        if (!name) return "ERROR: container name is required.";
        return safeExec(`docker start ${shQuote(name)}`);
      }),
  },
  {
    name: "stop_container",
    description:
      "Stop a running Docker container. MUTATING — requires explicit user confirmation before it runs.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Container name." } },
      required: ["name"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const name = String(args?.name || "").trim();
        if (!name) return "ERROR: container name is required.";
        return safeExec(`docker stop ${shQuote(name)}`);
      }),
  },
];

const TOOL_MAP = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AgentTool | undefined {
  return TOOL_MAP.get(name);
}

/** OpenAI tools/function-calling schema for the chat completions API. */
export function getOpenAIToolSchemas() {
  return AGENT_TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Anthropic (Messages API) tool schema. */
export function getAnthropicToolSchemas() {
  return AGENT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as { type: "object"; [k: string]: unknown },
  }));
}

export function isReadOnlyTool(name: string): boolean {
  return TOOL_MAP.get(name)?.readOnly ?? false;
}
