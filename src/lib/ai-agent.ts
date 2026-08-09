import {
  execOnVps,
  getSystemStats,
  getDockerContainers,
  getDockerStats,
  getContainerLogs,
  getSystemConfig,
  shQuote,
  runDockerCompose,
  runDockerComposeDown,
  resolveComposeProjectPath,
  getDockerContainerLabels,
  getDockerComposeCommand,
  buildManagedComposeInvocation,
} from "@/lib/vps";
import { execOnTarget, execOnTargetStrict } from "@/lib/host-exec";
import { prisma } from "@/lib/prisma";
import { getHostCapabilities, clearHostCapabilitiesCache, formatCapabilitiesForPrompt } from "@/lib/host-capabilities";
import {
  installDocker,
  installCaddy,
  installNginx,
  installNode,
  installGit,
  installK3s,
  installKubectl,
  installHelm,
  installTerraform,
  installCloudflared,
  canInstallHostPackages,
  type BootstrapResult,
} from "@/lib/bootstrap";
import {
  isAllowedSystemPath,
  isApplicationSourcePath,
  validateSafePath,
  validateSystemCommand,
} from "@/lib/host-safety";
import { listPublishedGuides, getGuideBySlug, parseGuideSteps } from "@/lib/guides/loader";
import { componentAction, getComponentStatus, type ComponentAction } from "@/lib/bootstrap";
import { reproduceInDaytona } from "@/lib/intelligence/daytona";
import {
  openSourceRepairPullRequest,
  prepareSourceRepairPlan,
  readSourceAtDeployedRevision,
} from "@/lib/source-repair";
import { redactComposeSecrets } from "@/lib/managed-deployments";
import { createHttpProbeExecutor } from "@/lib/intelligence/probes";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export type ResolvedAgentToolCall = {
  name: string;
  args: Record<string, unknown>;
  reroutedFrom?: string;
};

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

/**
 * Like safeExec, but routes through execOnTarget so host-level commands hit the
 * host OS when GroundControl runs inside a container.
 */
async function safeExecOnTarget(command: string): Promise<string> {
  try {
    const { stdout, stderr, code } = await execOnTarget(command);
    const out = (stdout || "").trim();
    const err = (stderr || "").trim();
    if (out) {
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

export function isSafeRouteEnvPrefix(value: string): boolean {
  return /^(WEB|APP|FRONTEND|BACKEND|API|SERVER|HTTP|HTTPS)$/i.test(value.trim());
}

export function isSafeComposeService(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.trim());
}

export function isSafeBindHost(value: string): boolean {
  return ["127.0.0.1", "0.0.0.0", "localhost"].includes(value.trim());
}

function buildRoutePortEnvPatchCommand(args: {
  projectPath: string;
  keyPrefix: string;
  bindHost: string;
  hostPort: number;
  service: string;
  composeCommand: string;
  publicUrl?: string;
}) {
  const prefix = args.keyPrefix.trim().toUpperCase();
  const envHostKey = `${prefix}_BIND_HOST`;
  const envPortKey = `${prefix}_PORT`;
  const publicCheck = args.publicUrl
    ? [
        `gc_public_url=${shQuote(args.publicUrl)}`,
        `for gc_i in 1 2 3 4 5 6 7 8 9 10 11 12; do`,
        `  if curl -k -fsS --max-time 15 "$gc_public_url" >/dev/null; then printf '%s\\n' "[verify] public route healthy: $gc_public_url"; break; fi`,
        `  if [ "$gc_i" -eq 12 ]; then printf '%s\\n' "[verify] public route failed: $gc_public_url" >&2; exit 43; fi`,
        `  sleep 5`,
        `done`,
      ]
    : [`printf '%s\\n' '[verify] public route not provided; skipped'`];
  return [
    `set -eu`,
    `cd ${shQuote(args.projectPath)}`,
    `test -f docker-compose.yml || test -f docker-compose.yaml || test -f compose.yml || test -f compose.yaml`,
    `cp .env ".env.groundcontrol-backup-$(date +%Y%m%d%H%M%S)" 2>/dev/null || : > .env`,
    `gc_upsert_env() {`,
    `  gc_key="$1"; gc_value="$2";`,
    `  if grep -q "^${"${gc_key}"}=" .env 2>/dev/null; then`,
    `    awk -v k="$gc_key" -v v="$gc_value" 'BEGIN{done=0} index($0,k"=")==1 {print k"="v; done=1; next} {print} END{if(done==0) print k"="v}' .env > .env.new`,
    `  else`,
    `    cp .env .env.new 2>/dev/null || : > .env.new`,
    `    printf '%s=%s\\n' "$gc_key" "$gc_value" >> .env.new`,
    `  fi`,
    `  chmod 600 .env.new && mv .env.new .env && chmod 600 .env`,
    `}`,
    `gc_upsert_env ${shQuote(envHostKey)} ${shQuote(args.bindHost)}`,
    `gc_upsert_env ${shQuote(envPortKey)} ${shQuote(String(args.hostPort))}`,
    `${args.composeCommand} config >/dev/null`,
    `${args.composeCommand} up -d --force-recreate ${shQuote(args.service)}`,
    `printf '%s\\n' ${shQuote(`[repair] ${envHostKey}=${args.bindHost} ${envPortKey}=${args.hostPort}; recreated ${args.service}`)}`,
    ...publicCheck,
    `${args.composeCommand} ps ${shQuote(args.service)}`,
  ].join("\n");
}

function clipOperationalEvidence(value: string, max = 8_000): string {
  const normalized = String(value || "").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}\n… evidence clipped`;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(normalized);
}

async function assertPublicProbeUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Verification requires a credential-free HTTP or HTTPS URL.");
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || isPrivateAddress(url.hostname)) {
    throw new Error("External verification cannot target a local or private address.");
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("External verification resolved to a local or private address.");
  }
  return url;
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
  "netstat", "ss", "ip", "ifconfig", "ping", "dig", "nslookup", "host", "curl",
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

/**
 * Correct a model selecting the mutating system escape hatch for a command
 * that the read-only diagnostic policy already permits. Safety and approval
 * are deterministic; a model's tool-name mistake must not create a fake
 * mutation or terminate an incident.
 */
export function resolveAgentToolCall(
  name: string,
  args: Record<string, unknown>
): ResolvedAgentToolCall {
  if (name !== "run_system_command") return { name, args };
  const command = String(args.command || "").trim();
  if (command && checkDiagnosticCommand(command) === null) {
    return {
      name: "run_diagnostic",
      args: { command },
      reroutedFrom: name,
    };
  }
  return { name, args };
}

// ---------------------------------------------------------------------------
// Host capability helpers
// ---------------------------------------------------------------------------

/** Read a system file if its path is allow-listed. */
async function readSystemFile(path: string, limitBytes = 128_000): Promise<string> {
  const refusal = validateSafePath(path);
  if (refusal) return `ERROR: ${refusal}`;
  const result = await execOnTarget(`cat ${shQuote(path)} 2>&1 | head -c ${limitBytes}`);
  if (result.code !== 0) return `ERROR: could not read ${path}\n${result.stderr || result.stdout}`;
  return result.stdout || "(empty file)";
}

async function writeSystemFile(
  path: string,
  content: string,
  emergencyOverride = false,
  emergencyReason = ""
): Promise<string> {
  const refusal = validateSafePath(path);
  if (refusal) return `ERROR: ${refusal}`;
  if (isApplicationSourcePath(path)) {
    if (
      process.env.GC_ALLOW_EMERGENCY_SOURCE_MUTATION !== "1" ||
      !emergencyOverride ||
      emergencyReason.trim().length < 12
    ) {
      return (
        "ERROR: Direct application-source mutation is disabled. Prepare a validated Daytona source repair and open a pull request. " +
        "A temporary live override is available only when GC_ALLOW_EMERGENCY_SOURCE_MUTATION=1 and the operator explicitly supplies an emergency reason."
      );
    }
  }
  const b64 = Buffer.from(content).toString("base64");
  const mkdir = await execOnTarget(`mkdir -p "$(dirname ${shQuote(path)})"`);
  if (mkdir.code !== 0) return `ERROR: could not create parent directory\n${mkdir.stderr}`;
  const backup = await execOnTarget(`test -f ${shQuote(path)} && cp ${shQuote(path)} ${shQuote(path)}.bak-$(date +%s) 2>/dev/null || true`);
  if (backup.code !== 0) return `ERROR: backup failed\n${backup.stderr}`;
  const result = await execOnTarget(`printf '%s' ${shQuote(b64)} | base64 -d > ${shQuote(path)} 2>&1`);
  if (result.code !== 0) return `ERROR: could not write ${path}\n${result.stderr || result.stdout}`;
  return isApplicationSourcePath(path)
    ? `EMERGENCY OVERRIDE: wrote ${content.length} bytes to ${path}. Backup created before mutation. Reason: ${emergencyReason.trim()}`
    : `Wrote ${content.length} bytes to ${path}.`;
}

/** Map installer names to bootstrap functions. */
const SOFTWARE_INSTALLERS: Record<string, () => Promise<BootstrapResult>> = {
  docker: installDocker,
  caddy: installCaddy,
  nginx: installNginx,
  node: installNode,
  git: installGit,
  k3s: installK3s,
  kubectl: installKubectl,
  helm: installHelm,
  terraform: installTerraform,
  cloudflared: installCloudflared,
};

async function ensureSoftware(name: string): Promise<string> {
  const normalized = name.toLowerCase().trim();
  const installer = SOFTWARE_INSTALLERS[normalized];
  if (!installer) {
    return `ERROR: unknown software "${name}". Supported: ${Object.keys(SOFTWARE_INSTALLERS).join(", ")}.`;
  }
  const allowed = await canInstallHostPackages();
  if (!allowed.ok) return `ERROR: ${allowed.reason || "Host package installs are not allowed in this environment."}`;
  const result = await installer();
  clearHostCapabilitiesCache();
  if (!result.success) return `ERROR: install failed\n${result.error || result.output}`;
  return `Installed ${normalized}.\n${result.output}`;
}

/** Manage a service using the detected init system. */
async function manageService(service: string, action: string): Promise<string> {
  const validActions = new Set(["start", "stop", "restart", "reload", "enable", "disable", "status"]);
  const a = action.toLowerCase().trim();
  if (!validActions.has(a)) return `ERROR: unsupported action "${action}". Use start/stop/restart/reload/enable/disable/status.`;

  const caps = await getHostCapabilities();
  const init = caps.capabilities.initSystem;

  if (init === "systemd") {
    if (a === "enable" || a === "disable") {
      return safeExecOnTarget(`systemctl ${a} ${shQuote(service)}`);
    }
    return safeExecOnTarget(`systemctl ${a} ${shQuote(service)}`);
  }

  if (init === "openrc") {
    if (a === "enable") return safeExecOnTarget(`rc-update add ${shQuote(service)} default`);
    if (a === "disable") return safeExecOnTarget(`rc-update delete ${shQuote(service)} default`);
    return safeExecOnTarget(`rc-service ${shQuote(service)} ${a}`);
  }

  if (a === "enable" || a === "disable") {
    return `ERROR: enable/disable are not supported on init system "${init}".`;
  }
  return safeExecOnTarget(`service ${shQuote(service)} ${a}`);
}

/** List services for the detected init system. */
async function listServices(): Promise<string> {
  const caps = await getHostCapabilities();
  const init = caps.capabilities.initSystem;
  if (init === "systemd") {
    return safeExecOnTarget("systemctl list-units --type=service --state=running,failed --no-pager --plain");
  }
  if (init === "openrc") {
    return safeExecOnTarget("rc-status --servicelist 2>/dev/null || rc-update show");
  }
  return safeExecOnTarget("service --status-all 2>&1 || echo 'service command unavailable'");
}

/** Run a scoped system command with validation and confirmation. */
async function runSystemCommand(command: string): Promise<string> {
  const refusal = validateSystemCommand(command);
  if (refusal) return `ERROR: ${refusal}`;
  return safeExecOnTarget(command);
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
        return safeExecOnTarget(cmd);
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
        return safeExecOnTarget(cmd);
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
        return safeExecOnTarget(
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
        const df = await safeExecOnTarget("df -h");
        const du = await safeExecOnTarget(
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
          return safeExecOnTarget(
            `for f in ${shQuote(dir)}/*; do [ -f "$f" ] && echo "===== $f =====" && cat "$f"; done 2>/dev/null || echo "(no nginx site files found in ${dir})"`
          );
        }
        const dir = config.caddySitesDir || "/etc/caddy/sites";
        const file = config.caddyFile || "/etc/caddy/Caddyfile";
        return safeExecOnTarget(
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
        return safeExecOnTarget(command);
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
        const [topMem, topCpu] = await Promise.all([safeExecOnTarget(topMemCmd), safeExecOnTarget(topCpuCmd)]);

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
  {
    name: "read_compose_config",
    description:
      "Read the docker-compose.yml (and any compose override files) for a project. Use this BEFORE assuming which services a compose project declares or whether they are running.",
    parameters: {
      type: "object",
      properties: {
        projectSlug: { type: "string", description: "Project directory name under the project root (e.g. 'perfume-emporio')." },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const slug = String(args?.projectSlug || "").trim();
        if (!slug) return "ERROR: projectSlug is required.";
        const resolved = await resolveComposeProjectPath(slug);
        const config = await getSystemConfig();
        const root = config.projectRoot || "/opt";
        const projectPath = resolved.projectPath || `${root}/${slug}`;
        const files = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
        for (const f of files) {
          const path = `${projectPath}/${f}`;
          const result = await safeExecOnTarget(`cat ${shQuote(path)} 2>/dev/null`);
          if (!result.startsWith("[exit") && !result.startsWith("ERROR:")) {
            return `===== ${path} =====\n${redactComposeSecrets(result)}`;
          }
        }
        return `No docker-compose/compose file found in ${projectPath}.`;
      }),
  },
  {
    name: "reproduce_incident_in_daytona",
    description:
      "Reproduce an incident against an exact repository revision in an isolated Daytona sandbox. Use only after live host evidence points to a repository-code, Compose, or proxy-config defect. Do not use for a stopped container, missing runtime link, unreachable host port, or another host-state failure. No production secret values are sent. Returns the bounded validation result and always destroys the sandbox.",
    parameters: {
      type: "object",
      properties: {
        repositoryUrl: {
          type: "string",
          description: "Credential-free HTTPS repository URL linked to the affected deployment.",
        },
        branch: {
          type: "string",
          description: "Repository branch when known.",
        },
        commitSha: {
          type: "string",
          description: "Exact deployed commit SHA when known.",
        },
        testCommand: {
          type: "string",
          description: "One bounded project validation command, such as npm test, npm run build, pytest, go test ./..., or docker compose config.",
        },
        composeSnippet: {
          type: "string",
          description: "Optional sanitized relevant Compose excerpt. Never include secret values.",
        },
        proxySnippet: {
          type: "string",
          description: "Optional sanitized relevant proxy excerpt. Never include secret values.",
        },
        envKeys: {
          type: "array",
          items: { type: "string" },
          description: "Optional environment variable names only; never KEY=value.",
        },
        journeyUrl: {
          type: "string",
          description: "Affected public URL for incident context.",
        },
      },
      required: ["repositoryUrl", "testCommand"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const envKeys = Array.isArray(args?.envKeys)
          ? args.envKeys.map(String).filter((key) => key && !key.includes("="))
          : [];
        const result = await reproduceInDaytona({
          repositoryUrl: String(args?.repositoryUrl || ""),
          branch: args?.branch ? String(args.branch) : undefined,
          commitSha: args?.commitSha ? String(args.commitSha) : undefined,
          testCommand: String(args?.testCommand || ""),
          composeSnippet: args?.composeSnippet ? String(args.composeSnippet) : undefined,
          proxySnippet: args?.proxySnippet ? String(args.proxySnippet) : undefined,
          envKeys,
          journeyUrl: args?.journeyUrl ? String(args.journeyUrl) : undefined,
          budgetSeconds: 180,
        });
        return JSON.stringify(result, null, 2);
      }),
  },
  {
    name: "read_repository_source_at_revision",
    description:
      "Read one repository file from the exact deployed commit through the connected GitHub App, with likely credential values redacted. Use this before prepare_source_fix_in_daytona so every find string comes from the actual repository revision rather than a live-host copy or guess.",
    parameters: {
      type: "object",
      properties: {
        repositoryUrl: {
          type: "string",
          description: "Credential-free HTTPS GitHub repository URL linked to the deployment.",
        },
        commitSha: {
          type: "string",
          description: "Exact full deployed commit SHA. Never guess this value.",
        },
        filePath: {
          type: "string",
          description: "Repository-relative source file path.",
        },
      },
      required: ["repositoryUrl", "commitSha", "filePath"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => JSON.stringify(await readSourceAtDeployedRevision({
        repositoryUrl: String(args?.repositoryUrl || ""),
        commitSha: String(args?.commitSha || ""),
        filePath: String(args?.filePath || ""),
      }), null, 2)),
  },
  {
    name: "prepare_source_fix_in_daytona",
    description:
      "Run the full Daytona source-repair workbench for a repository-backed code, Compose, or proxy defect. Daytona clones and proves the exact deployed commit, installs dependencies, requires a focused command to reproduce the failure before the edit and pass after it, runs one or two independent regression commands, captures a reviewable diff and complete validation evidence, destroys the sandbox, and stores a short-lived repair plan. This does not mutate production. Use this instead of write_system_file for files under /opt, deployment roots, web roots, or home directories.",
    parameters: {
      type: "object",
      properties: {
        repositoryUrl: {
          type: "string",
          description: "Credential-free HTTPS GitHub repository URL linked to the deployment.",
        },
        baseBranch: {
          type: "string",
          description: "PR target branch, normally the repository default branch.",
        },
        commitSha: {
          type: "string",
          description: "Exact full commit SHA of the deployed revision. Never guess this value.",
        },
        filePath: {
          type: "string",
          description: "Repository-relative path to the source file being corrected.",
        },
        edits: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              find: {
                type: "string",
                minLength: 1,
                description: "Exact unique source text from the repository file at the deployed commit.",
              },
              replace: {
                type: "string",
                description: "Exact replacement text.",
              },
            },
            required: ["find", "replace"],
            additionalProperties: false,
          },
          description:
            "One to eight exact, minimal edits. GroundControl fetches the complete file from GitHub; never pass a live-host file or secret value.",
        },
        validationCommand: {
          type: "string",
          description: "One focused bounded command that fails at the exact deployed revision and passes only after the candidate, proving the repair rather than merely building the repository.",
        },
        regressionCommands: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          items: { type: "string" },
          description: "One or two independent bounded project checks that must pass after the candidate, such as the relevant test suite, build, lint, typecheck, or docker compose config. Do not repeat validationCommand.",
        },
        incidentSummary: {
          type: "string",
          description: "Concise evidence-backed description of the production defect.",
        },
        verificationUrl: {
          type: "string",
          description: "Public endpoint GroundControl must verify after the normal deployment pipeline completes.",
        },
      },
      required: [
        "repositoryUrl",
        "commitSha",
        "filePath",
        "edits",
        "validationCommand",
        "regressionCommands",
        "incidentSummary",
      ],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const edits = Array.isArray(args?.edits)
          ? args.edits.map((edit) => {
              const value = edit && typeof edit === "object"
                ? edit as Record<string, unknown>
                : {};
              return { find: String(value.find || ""), replace: String(value.replace || "") };
            })
          : [];
        if (!edits.length || edits.some((edit) => !edit.find.trim())) {
          return "ERROR: Source repair requires one to eight non-empty exact edits from the repository file. Continue investigating until the exact deployed source text is known.";
        }
        const regressionCommands = Array.isArray(args?.regressionCommands)
          ? args.regressionCommands.map(String).map((command) => command.trim()).filter(Boolean)
          : [];
        if (regressionCommands.length === 0) {
          return "ERROR: Daytona source repair requires a focused reproduction plus at least one independent regression command.";
        }
        const result = await prepareSourceRepairPlan({
          repositoryUrl: String(args?.repositoryUrl || ""),
          baseBranch: args?.baseBranch ? String(args.baseBranch) : undefined,
          commitSha: String(args?.commitSha || ""),
          filePath: String(args?.filePath || ""),
          edits,
          validationCommand: String(args?.validationCommand || ""),
          regressionCommands,
          incidentSummary: String(args?.incidentSummary || ""),
          verificationUrl: args?.verificationUrl ? String(args.verificationUrl) : undefined,
        });
        return JSON.stringify(result, null, 2);
      }),
  },
  {
    name: "open_validated_fix_pr",
    description:
      "Open a pull request from a short-lived Daytona-validated source repair plan. This changes the repository, not the live server, and requires explicit operator confirmation. It refuses stale source, missing GitHub write permissions, expired plans, or unvalidated candidates. The normal delivery pipeline remains authoritative after merge.",
    parameters: {
      type: "object",
      properties: {
        repairPlanId: {
          type: "string",
          description: "Repair plan ID returned by prepare_source_fix_in_daytona.",
        },
        title: {
          type: "string",
          description: "Concise pull request title describing the repair.",
        },
      },
      required: ["repairPlanId", "title"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const result = await openSourceRepairPullRequest({
          repairPlanId: String(args?.repairPlanId || ""),
          title: String(args?.title || ""),
        });
        return JSON.stringify(result, null, 2);
      }),
  },
  {
    name: "list_project_containers",
    description:
      "List Docker containers that belong to a specific compose project or project directory. Use this to avoid hallucinating which containers belong to a project.",
    parameters: {
      type: "object",
      properties: {
        projectSlug: { type: "string", description: "Project directory name or compose project name." },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const slug = String(args?.projectSlug || "").trim().toLowerCase();
        if (!slug) return "ERROR: projectSlug is required.";
        const [containers, labels] = await Promise.all([getDockerContainers(), getDockerContainerLabels()]);
        const labelMap = new Map(labels.map((l) => [l.name, l]));
        const matches = containers.filter((c) => {
          const info = labelMap.get(c.name);
          const nameMatch = c.name.toLowerCase().startsWith(`${slug}-`) || c.name.toLowerCase().includes(slug);
          const labelMatch =
            (info?.project || "").toLowerCase() === slug ||
            (info?.projectSlug || "").toLowerCase() === slug;
          return nameMatch || labelMatch;
        });
        if (!matches.length) return `No containers found for project "${slug}".`;
        return JSON.stringify(matches, null, 2);
      }),
  },
  {
    name: "compose_ps",
    description:
      "Show running/declared services for a compose project (equivalent to docker compose ps). Use to check which compose services are actually up.",
    parameters: {
      type: "object",
      properties: {
        projectSlug: { type: "string", description: "Project directory name under the project root." },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const slug = String(args?.projectSlug || "").trim();
        if (!slug) return "ERROR: projectSlug is required.";
        const resolved = await resolveComposeProjectPath(slug);
        const result = await runDockerCompose(resolved.projectPath, "ps --all");
        const out = result.stdout || "";
        const err = result.stderr || "";
        if (result.code !== 0) return `ERROR: docker compose ps failed (exit ${result.code}).\n${err || out}`;
        return out || "(no services)";
      }),
  },
  {
    name: "investigate_compose_failure",
    description:
      "Collect one coherent, read-only evidence bundle for a failed Compose deployment: declared services, all project containers including exited one-shot services, and bounded logs from failed, restarting, or unhealthy containers. Use this before attributing a deployment failure to source code or preparing a Daytona repair.",
    parameters: {
      type: "object",
      properties: {
        projectSlug: { type: "string", description: "Project directory name or Compose project name." },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const slug = String(args?.projectSlug || "").trim();
        if (!slug) return "ERROR: projectSlug is required.";
        const resolved = await resolveComposeProjectPath(slug);
        const [initialServicesResult, psResult, containers, labels] = await Promise.all([
          runDockerCompose(resolved.projectPath, "config --services"),
          runDockerCompose(resolved.projectPath, "ps --all"),
          getDockerContainers(),
          getDockerContainerLabels(),
        ]);
        let servicesResult = initialServicesResult;
        let composeConfigurationWarning: string | null = null;
        if (servicesResult.code !== 0) {
          const detail = (servicesResult.stderr || servicesResult.stdout || "docker compose config failed").trim();
          if (detail.includes("[groundcontrol] managed environment")) {
            // A missing materialized secret file is itself evidence, but it
            // must not prevent the investigator from seeing declared services,
            // containers and failure logs. Resolve the repository model without
            // the runtime env overlay and keep the warning in the evidence.
            const composeCommand = await getDockerComposeCommand(undefined, execOnTargetStrict);
            const fallback = await execOnTargetStrict(
              `cd ${shQuote(resolved.projectPath)} && ${buildManagedComposeInvocation(
                composeCommand,
                "config --services",
                undefined,
                { includeEnvironment: false }
              )}`
            );
            if (fallback.code !== 0) {
              return `ERROR: effective Compose configuration could not be resolved.\n${detail}\n${
                (fallback.stderr || fallback.stdout || "repository Compose model also failed").trim()
              }`;
            }
            servicesResult = fallback;
            composeConfigurationWarning = detail;
          } else {
            return `ERROR: effective Compose configuration could not be resolved.\n${detail}`;
          }
        }

        const normalized = slug.toLowerCase();
        const labelMap = new Map(labels.map((label) => [label.name, label]));
        const projectContainers = containers.filter((container) => {
          const label = labelMap.get(container.name);
          return (
            (label?.project || "").toLowerCase() === normalized ||
            (label?.projectSlug || "").toLowerCase() === normalized ||
            container.name.toLowerCase().startsWith(`${normalized}-`) ||
            container.name.toLowerCase().startsWith(`${normalized}_`)
          );
        });
        const candidates = projectContainers.filter((container) => (
          /unhealthy|restarting|dead/i.test(container.status) ||
          (container.state !== "running" && !/exited\s+\(0\)/i.test(container.status))
        )).slice(0, 4);
        const failureLogs = await Promise.all(candidates.map(async (container) => ({
          container: container.name,
          service: labelMap.get(container.name)?.service || null,
          evidence: clipOperationalEvidence(await getContainerLogs(container.name, 160)),
        })));

        return JSON.stringify({
          project: slug,
          composeConfigurationWarning,
          declaredServices: servicesResult.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
          composeState: psResult.code === 0
            ? psResult.stdout.trim()
            : `ERROR: ${(psResult.stderr || psResult.stdout).trim()}`,
          containers: projectContainers.map((container) => ({
            name: container.name,
            service: labelMap.get(container.name)?.service || null,
            image: container.image,
            state: container.state,
            status: container.status,
          })),
          failureCandidates: failureLogs,
          conclusionRule: failureLogs.length
            ? "Use the earliest failed dependency supported by these logs; later missing services are symptoms until disproven."
            : "No failed container log was found. Investigate image pulls, environment materialization, host ports, and the public route before proposing source changes.",
        }, null, 2);
      }),
  },
  {
    name: "inspect_container",
    description:
      "Inspect one existing Docker container without reading its injected environment values. Returns state, image, health, Compose identity, published ports, networks, labels, and healthcheck.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact existing container name." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const name = String(args?.name || "").trim();
        if (!name) return "ERROR: container name is required.";
        const format = [
          "{",
          '"name":{{json .Name}},',
          '"image":{{json .Config.Image}},',
          '"state":{{json .State}},',
          '"ports":{{json .NetworkSettings.Ports}},',
          '"networks":{{json .NetworkSettings.Networks}},',
          '"labels":{{json .Config.Labels}},',
          '"healthcheck":{{json .Config.Healthcheck}}',
          "}",
        ].join("");
        const output = await safeExecOnTarget(
          `docker inspect --format ${shQuote(format)} ${shQuote(name)}`
        );
        return redactComposeSecrets(output);
      }),
  },
  {
    name: "verify_public_endpoint",
    description:
      "Perform a real external HTTP check after a repair or runtime action. It reads only status and latency, never the response body. A successful mutation is not a verified recovery until this passes.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Credential-free public HTTP or HTTPS endpoint to verify.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const url = await assertPublicProbeUrl(String(args?.url || ""));
        const result = await createHttpProbeExecutor(10_000).fetchStatus(url.toString());
        return JSON.stringify({
          url: url.toString(),
          ok: result.statusCode >= 200 && result.statusCode < 400,
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
          observedAt: new Date().toISOString(),
          proves: "external HTTP outcome only",
        });
      }),
  },
  // --- Mutating tools: never auto-execute. Require explicit confirmation. ----
  {
    name: "compose_up",
    description:
      "Create and start services declared in a docker-compose.yml (equivalent to docker compose up -d). MUTATING — requires explicit user confirmation before it runs. Use this when the user wants to start a project's compose services, NOT start_container.",
    parameters: {
      type: "object",
      properties: {
        projectSlug: { type: "string", description: "Project directory name under the project root (e.g. 'perfume-emporio')." },
        services: { type: "array", items: { type: "string" }, description: "Optional service names to start. If omitted, all services are started." },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const slug = String(args?.projectSlug || "").trim();
        if (!slug) return "ERROR: projectSlug is required.";
        const resolved = await resolveComposeProjectPath(slug);
        const services = Array.isArray(args?.services) ? args.services.map(String).filter(Boolean) : [];
        const svcArg = services.length ? services.map(shQuote).join(" ") : "";
        const result = await runDockerCompose(resolved.projectPath, `up -d ${svcArg}`.trim());
        const out = result.stdout || "";
        const err = result.stderr || "";
        if (result.code !== 0) return `ERROR: docker compose up failed (exit ${result.code}).\n${err || out}`;
        return out || `Compose services for ${slug} started.`;
      }),
  },
  {
    name: "compose_down",
    description:
      "Stop and remove services declared in a docker-compose.yml (equivalent to docker compose down). MUTATING — requires explicit user confirmation before it runs.",
    parameters: {
      type: "object",
      properties: {
        projectSlug: { type: "string", description: "Project directory name under the project root." },
        services: { type: "array", items: { type: "string" }, description: "Optional service names to stop/remove. If omitted, all services are stopped/removed." },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const slug = String(args?.projectSlug || "").trim();
        if (!slug) return "ERROR: projectSlug is required.";
        const resolved = await resolveComposeProjectPath(slug);
        const services = Array.isArray(args?.services) ? args.services.map(String).filter(Boolean) : [];
        const result = await runDockerComposeDown(resolved.projectPath, services);
        const out = result.stdout || "";
        const err = result.stderr || "";
        if (result.code !== 0) return `ERROR: docker compose down failed (exit ${result.code}).\n${err || out}`;
        return out || `Compose services for ${slug} stopped.`;
      }),
  },
  {
    name: "reconcile_compose_route_port",
    description:
      "Repair proxy-to-runtime port drift for a Compose deployment by safely upserting <PREFIX>_BIND_HOST and <PREFIX>_PORT in the deployment .env, validating Compose, recreating one selected service, and optionally verifying the public URL. MUTATING — requires explicit user confirmation. Use when evidence shows Caddy/Nginx targets a loopback port but the related Compose service is published on a different host port.",
    parameters: {
      type: "object",
      properties: {
        projectSlug: { type: "string", description: "Compose project/folder slug, such as rentaweekend." },
        service: { type: "string", description: "Compose service to recreate, such as web." },
        keyPrefix: { type: "string", description: "Env key prefix to update. WEB writes WEB_BIND_HOST and WEB_PORT.", enum: ["WEB", "APP", "FRONTEND", "BACKEND", "API", "SERVER", "HTTP", "HTTPS"] },
        bindHost: { type: "string", description: "Host bind address for the published service port.", enum: ["127.0.0.1", "0.0.0.0", "localhost"] },
        hostPort: { type: "integer", description: "Expected host port used by the reverse proxy, 1-65535." },
        publicUrl: { type: "string", description: "Optional public URL to verify after recreation." },
      },
      required: ["projectSlug", "service", "keyPrefix", "bindHost", "hostPort"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const slug = String(args?.projectSlug || "").trim();
        const service = String(args?.service || "").trim();
        const keyPrefix = String(args?.keyPrefix || "").trim().toUpperCase();
        const bindHost = String(args?.bindHost || "").trim();
        const hostPort = Number(args?.hostPort);
        const publicUrl = String(args?.publicUrl || "").trim();
        if (!slug) return "ERROR: projectSlug is required.";
        if (!isSafeComposeService(service)) return "ERROR: service must be a safe Compose service name.";
        if (!isSafeRouteEnvPrefix(keyPrefix)) return "ERROR: keyPrefix is not allowed for route-port repair.";
        if (!isSafeBindHost(bindHost)) return "ERROR: bindHost must be 127.0.0.1, 0.0.0.0, or localhost.";
        if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) return "ERROR: hostPort must be between 1 and 65535.";
        if (publicUrl && !/^https?:\/\/[^@\s]+$/i.test(publicUrl)) return "ERROR: publicUrl must be an http(s) URL without credentials.";
        const resolved = await resolveComposeProjectPath(slug, service);
        const composeCommand = await getDockerComposeCommand(undefined, execOnTargetStrict);
        const command = buildRoutePortEnvPatchCommand({
          projectPath: resolved.projectPath,
          keyPrefix,
          bindHost,
          hostPort,
          service,
          composeCommand,
          publicUrl,
        });
        const result = await execOnTargetStrict(command);
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        if (result.code !== 0) return `ERROR: route-port reconciliation failed (exit ${result.code}).\n${output}`;
        return output || `Route port reconciled for ${slug}/${service}.`;
      }),
  },
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
  // --- Host capability and system-level tools --------------------------------
  {
    name: "get_host_capabilities",
    description:
      "Get a unified report of the active VPS: OS, init system, installed tooling (Docker, Caddy, k3s, kubectl, Helm, Terraform, cloudflared), filesystem layout, and network tool. Call this first when asked to install, configure, or manage the host itself.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const caps = await getHostCapabilities();
        return formatCapabilitiesForPrompt(caps) + "\n\n" + JSON.stringify(caps, null, 2);
      }),
  },
  {
    name: "read_system_file",
    description:
      "Read the contents of an allow-listed system configuration file (Caddyfile, nginx site, /etc/hosts, env files, systemd units, project files under /opt, etc.). Paths outside the allow-list are refused.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path to read." },
        limitBytes: { type: "integer", description: "Max bytes to read (default 128KB).", default: 128000 },
      },
      required: ["path"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const path = String(args?.path || "").trim();
        const limit = Math.max(1, Math.min(1_000_000, Number(args?.limitBytes) || 128_000));
        if (!path) return "ERROR: path is required.";
        return readSystemFile(path, limit);
      }),
  },
  {
    name: "list_services",
    description:
      "List running/failed services on the host using the detected init system (systemd, OpenRC, or sysvinit service).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () => guard(listServices),
  },
  {
    name: "ensure_software",
    description:
      "Install a known binary/package on the host if it is not already present. Supports: docker, caddy, nginx, node, git, k3s, kubectl, helm, terraform, cloudflared. Uses the OS package manager or official installer scripts. MUTATING — requires explicit user confirmation.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Software name to install." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const name = String(args?.name || "").trim();
        if (!name) return "ERROR: software name is required.";
        return ensureSoftware(name);
      }),
  },
  {
    name: "manage_service",
    description:
      "Start, stop, restart, reload, enable, disable, or check status of a host service using the correct init system (systemctl, rc-service, or service). MUTATING — requires explicit user confirmation.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name (e.g., 'caddy', 'docker', 'nginx')." },
        action: { type: "string", enum: ["start", "stop", "restart", "reload", "enable", "disable", "status"], description: "Action to perform." },
      },
      required: ["service", "action"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const service = String(args?.service || "").trim();
        const action = String(args?.action || "").trim();
        if (!service) return "ERROR: service name is required.";
        return manageService(service, action);
      }),
  },
  {
    name: "write_system_file",
    description:
      "Write an allow-listed host system file with a timestamped backup. This is for host-owned configuration such as /etc/caddy, /etc/nginx, systemd, and init files. Application source under /opt, managed deployment roots, web roots, or home directories is blocked by default and must use a Daytona-validated pull request. A source-path write is emergency-only, requires GC_ALLOW_EMERGENCY_SOURCE_MUTATION=1, explicit operator request, and a recorded reason. MUTATING — requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path to write." },
        content: { type: "string", description: "Full file content." },
        emergencyOverride: {
          type: "boolean",
          description: "True only when the operator explicitly requests a temporary break-glass production override.",
        },
        emergencyReason: {
          type: "string",
          description: "Required operational reason for an enabled emergency source override.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const path = String(args?.path || "").trim();
        const content = String(args?.content ?? "");
        if (!path) return "ERROR: path is required.";
        if (!isAllowedSystemPath(path)) return `ERROR: path ${path} is not allow-listed.`;
        return writeSystemFile(
          path,
          content,
          args?.emergencyOverride === true,
          String(args?.emergencyReason || "")
        );
      }),
  },
  {
    name: "run_system_command",
    description:
      "Escape hatch to run a scoped system administration command (systemctl/service/rc-service, apt/apk/dnf, ufw/iptables/nft, sysctl, timedatectl, hostnamectl, etc.). Blocked patterns include rm, redirection, curl|sh, eval, sudo, netcat, reboot/shutdown. MUTATING — requires explicit user confirmation.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The system command to run." },
      },
      required: ["command"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const command = String(args?.command || "").trim();
        if (!command) return "ERROR: command is required.";
        return runSystemCommand(command);
      }),
  },
  // --- Interactive learning guide tools --------------------------------------
  {
    name: "list_guides",
    description:
      "List the interactive learning guides available in GroundControl (integrations, incidents, concepts, checklists). Use when the user wants to browse guides or find a walkthrough.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const guides = await listPublishedGuides();
        return JSON.stringify(
          guides.map((g) => ({ slug: g.slug, title: g.title, category: g.category, description: g.description })),
          null,
          2
        );
      }),
  },
  {
    name: "get_guide_step",
    description:
      "Get the full content of a specific step from an interactive guide. Use when the user asks about a guide step that is not the current one, or wants to peek ahead.",
    parameters: {
      type: "object",
      properties: {
        guideSlug: { type: "string", description: "Guide slug, e.g. 'k3s-integration'." },
        stepId: { type: "string", description: "Step id, e.g. 'install-k3s'." },
      },
      required: ["guideSlug", "stepId"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const slug = String(args?.guideSlug || "").trim();
        const stepId = String(args?.stepId || "").trim();
        if (!slug) return "ERROR: guideSlug is required.";
        if (!stepId) return "ERROR: stepId is required.";
        const guide = await getGuideBySlug(slug);
        if (!guide) return `Guide "${slug}" not found.`;
        const steps = parseGuideSteps(guide);
        const step = steps.find((s) => s.id === stepId);
        if (!step) return `Step "${stepId}" not found in guide "${slug}".`;
        return JSON.stringify(step, null, 2);
      }),
  },
  {
    name: "run_guide_check",
    description:
      "Run the verification command associated with a specific guide step on the active VPS. Use when the user is working through a guide and wants to validate the current step. The command is read-only by definition (it only inspects).",
    parameters: {
      type: "object",
      properties: {
        guideSlug: { type: "string", description: "Guide slug." },
        stepId: { type: "string", description: "Step id." },
      },
      required: ["guideSlug", "stepId"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const slug = String(args?.guideSlug || "").trim();
        const stepId = String(args?.stepId || "").trim();
        if (!slug) return "ERROR: guideSlug is required.";
        if (!stepId) return "ERROR: stepId is required.";
        const guide = await getGuideBySlug(slug);
        if (!guide) return `Guide "${slug}" not found.`;
        const steps = parseGuideSteps(guide);
        const step = steps.find((s) => s.id === stepId);
        if (!step) return `Step "${stepId}" not found in guide "${slug}".`;
        if (!step.checkCommand) return `Step "${stepId}" has no verification command.`;
        const { stdout, stderr, code } = await execOnVps(step.checkCommand);
        return JSON.stringify({ ok: code === 0, stdout, stderr, code, expectedOutput: step.expectedOutput }, null, 2);
      }),
  },
  // --- Bootstrap / component lifecycle tools ---------------------------------
  {
    name: "list_components",
    description:
      "List installable/manageable components on the active VPS and their current status (installed, running, version). Use when the user asks what is installed or what can be installed.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const tools = [
          "docker",
          "caddy",
          "nginx",
          "node",
          "git",
          "terraform",
          "cloudflared",
          "postgres",
          "redis",
          "traefik",
          "certbot",
          "k3s",
          "kubectl",
          "helm",
        ];
        const statuses = await Promise.all(tools.map((tool) => getComponentStatus(tool).then((s) => ({ tool, ...s }))));
        return JSON.stringify(statuses, null, 2);
      }),
  },
  {
    name: "component_action",
    description:
      "Install, uninstall, start, stop, restart, reload, or check status of a host/container component on the active VPS. Use when the user asks to manage infrastructure (e.g. 'stop caddy', 'uninstall k3s', 'restart docker'). For destructive actions (uninstall, stop, restart) the UI will ask the user to confirm before executing.",
    parameters: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          description:
            "Component name: docker, caddy, nginx, node, git, terraform, cloudflared, postgres, redis, traefik, certbot, k3s, kubectl, helm.",
        },
        action: {
          type: "string",
          description: "Action: install, reinstall, uninstall, start, stop, restart, reload, status.",
        },
      },
      required: ["tool", "action"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const tool = String(args?.tool || "").trim();
        const action = String(args?.action || "").trim() as ComponentAction;
        if (!tool) return "ERROR: tool is required.";
        if (!action) return "ERROR: action is required.";
        const valid: ComponentAction[] = ["install", "reinstall", "uninstall", "start", "stop", "restart", "reload", "status"];
        if (!valid.includes(action)) return `ERROR: action must be one of ${valid.join(", ")}.`;
        const result = await componentAction(tool, action);
        return JSON.stringify(result, null, 2);
      }),
  },
  // ── Cloudflare DNS tools ─────────────────────────────
  {
    name: "list_dns_zones",
    description: "List all Cloudflare DNS zones in your account. Use this to find available domains.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const zones = await (await import("./cloudflare")).listZones();
        return JSON.stringify(zones, null, 2);
      }),
  },
  {
    name: "list_dns_records",
    description: "List DNS records for a Cloudflare zone. Returns A, CNAME, MX, TXT, etc. records with their current values.",
    parameters: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Cloudflare zone ID (find with list_dns_zones)." },
      },
      required: ["zone_id"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const zoneId = String(args?.zone_id || "").trim();
        if (!zoneId) return "ERROR: zone_id is required.";
        const records = await (await import("./cloudflare")).listDnsRecords(zoneId);
        return JSON.stringify(records, null, 2);
      }),
  },
  {
    name: "create_dns_record",
    description: "Create a new DNS record in Cloudflare. MUTATING — requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Cloudflare zone ID." },
        type: { type: "string", description: "Record type: A, CNAME, MX, TXT, etc.", enum: ["A", "CNAME", "MX", "TXT", "AAAA"] },
        name: { type: "string", description: "Record name (e.g. 'app' for app.example.com, or '@' for root)." },
        content: { type: "string", description: "Record value. For A records: IP address. For CNAME: target domain." },
        ttl: { type: "integer", description: "TTL in seconds (default 1 = auto).", default: 1 },
        proxied: { type: "boolean", description: "Route through Cloudflare proxy (orange cloud). Default true.", default: true },
      },
      required: ["zone_id", "type", "name", "content"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const zoneId = String(args?.zone_id || "").trim();
        const type = String(args?.type || "A").trim();
        const name = String(args?.name || "").trim();
        const content = String(args?.content || "").trim();
        if (!zoneId || !name || !content) return "ERROR: zone_id, name, and content are required.";
        const result = await (await import("./cloudflare")).createDnsRecord(zoneId, {
          type: type as "A" | "CNAME",
          name,
          content,
          ttl: Number(args?.ttl) || 1,
          proxied: args?.proxied !== false,
        });
        return `DNS record created: ${JSON.stringify(result)}`;
      }),
  },
  {
    name: "delete_dns_record",
    description: "Delete a DNS record from Cloudflare. MUTATING — requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Cloudflare zone ID." },
        record_id: { type: "string", description: "DNS record ID (find with list_dns_records)." },
      },
      required: ["zone_id", "record_id"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const zoneId = String(args?.zone_id || "").trim();
        const recordId = String(args?.record_id || "").trim();
        if (!zoneId || !recordId) return "ERROR: zone_id and record_id are required.";
        await (await import("./cloudflare")).deleteDnsRecord(zoneId, recordId);
        return `DNS record ${recordId} deleted.`;
      }),
  },
  {
    name: "list_cloudflare_tunnels",
    description: "List Cloudflare Tunnels (Cloudflare Tunnel / Argo) for your account. Tunnels let you expose services without opening firewall ports.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const tunnels = await (await import("./cloudflare")).listTunnels();
        return JSON.stringify(tunnels, null, 2);
      }),
  },
  // ── Template tools ───────────────────────────────────
  {
    name: "list_templates",
    description: "List available deployment templates. Templates are pre-built production stacks (Caddy+App+DB, Traefik+Multi-App, etc.) that you can apply to deploy apps with best practices.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const { listTemplates } = await import("./template-engine");
        const templates = listTemplates();
        return JSON.stringify(templates.map(t => ({
          name: t.name,
          description: t.description,
          category: t.category,
          version: t.version,
          requires: t.requires,
          inputs: t.inputs.map(i => ({ name: i.name, prompt: i.prompt, default: i.default, generate: i.generate })),
        })), null, 2);
      }),
  },
  {
    name: "preview_template",
    description: "Preview what a template will generate — docker-compose.yml, proxy config, env schema — before applying it. Shows services, volumes, and configuration files.",
    parameters: {
      type: "object",
      properties: {
        template_name: { type: "string", description: "Template name (use list_templates to see available names)." },
        domain: { type: "string", description: "Domain for the app (e.g. app.example.com)." },
        app_port: { type: "string", description: "Port your app listens on (default 3000)." },
        app_container: { type: "string", description: "Container name (default 'app')." },
        db_user: { type: "string", description: "Database username." },
        db_name: { type: "string", description: "Database name." },
      },
      required: ["template_name"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const name = String(args?.template_name || "").trim();
        if (!name) return "ERROR: template_name is required.";
        const { loadTemplate, resolveTemplate, generatePreview } = await import("./template-engine");
        const template = loadTemplate(`${name}.yml`);
        if (!template) return `ERROR: template "${name}" not found. Use list_templates to see available templates.`;
        const inputs: Record<string, string> = {};
        if (args?.domain) inputs["domain"] = String(args.domain);
        if (args?.app_port) inputs["app_port"] = String(args.app_port);
        if (args?.app_container) inputs["app_container"] = String(args.app_container);
        if (args?.db_user) inputs["db_user"] = String(args.db_user);
        if (args?.db_name) inputs["db_name"] = String(args.db_name);
        const resolved = resolveTemplate(template, inputs);
        return generatePreview(resolved);
      }),
  },
  {
    name: "list_deployments",
    description:
      "List all template-managed deployments under the configured deployment root (default /srv/groundcontrol/deployments). Returns slug + path for each stack that has a compose file. Call this before delete_deployment.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    execute: async () =>
      guard(async () => {
        const {
          listManagedDeployments,
        } = await import("./managed-deployments");
        const { root, deployments } = await listManagedDeployments();
        if (deployments.length === 0) {
          return JSON.stringify({ root, deployments: [], message: `No managed deployments under ${root}` });
        }
        return JSON.stringify({
          root,
          deployments: deployments.map((d) => ({
            slug: d.slug,
            path: d.path,
            composePath: d.composePath,
          })),
        });
      }),
  },
  {
    name: "inspect_deployment",
    description:
      "Read a managed deployment's compose file (secrets redacted) and container status. Pass slug (e.g. 'gc-tunnel-proof') or full path under the managed root.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Deployment slug or full path (e.g. 'gc-tunnel-proof')." },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const {
          inspectManagedDeployment,
          formatResolveFailure,
        } = await import("./managed-deployments");
        const result = await inspectManagedDeployment(String(args?.slug || ""));
        if (!result.ok) {
          return formatResolveFailure({
            ok: false,
            error: result.error,
            root: result.root || "",
            existing: result.existing || [],
            lookedFor: result.lookedFor || String(args?.slug || ""),
          });
        }
        return JSON.stringify({
          slug: result.slug,
          path: result.path,
          composePath: result.composePath,
          compose: result.compose,
          containers: result.containers,
        });
      }),
  },
  {
    name: "preview_delete_deployment",
    description:
      "Read-only preview of what delete_deployment would remove: path, running containers, impact bullets. Call this before proposing delete_deployment so the user sees the blast radius.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Deployment slug or full path to preview deleting." },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    readOnly: true,
    execute: async (args) =>
      guard(async () => {
        const {
          previewDeleteManagedDeployment,
          formatResolveFailure,
        } = await import("./managed-deployments");
        const result = await previewDeleteManagedDeployment(String(args?.slug || ""));
        if (!result.ok) {
          return formatResolveFailure({
            ok: false,
            error: result.error,
            root: result.root || "",
            existing: result.existing || [],
            lookedFor: result.lookedFor || String(args?.slug || ""),
          });
        }
        return JSON.stringify(result);
      }),
  },
  {
    name: "delete_deployment",
    description:
      "Tear down and remove a managed deployment. MUTATING — runs compose down in the deployment directory, deletes files, cleans DB project rows. Requires confirmation. Prefer preview_delete_deployment first. Pass the exact slug from list_deployments.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Deployment slug or name to delete (from list_deployments)." },
        delete_volumes: {
          type: "boolean",
          description: "Also delete compose volumes? Defaults to false.",
          default: false,
        },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    readOnly: false,
    execute: async (args) =>
      guard(async () => {
        const {
          deleteManagedDeployment,
          formatResolveFailure,
        } = await import("./managed-deployments");
        const result = await deleteManagedDeployment(String(args?.slug || ""), {
          deleteVolumes: args?.delete_volumes === true,
          cleanupDb: true,
        });
        if (!result.ok) {
          return formatResolveFailure({
            ok: false,
            error: result.error,
            root: result.root || "",
            existing: result.existing || [],
            lookedFor: result.lookedFor || String(args?.slug || ""),
          });
        }
        return JSON.stringify({
          success: true,
          slug: result.slug,
          path: result.path,
          removed: result.removed,
          composeOutput: result.composeOutput,
          dbCleanup: result.dbCleanup,
        });
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
