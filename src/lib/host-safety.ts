import { shQuote } from "./vps";

/**
 * Allowed path patterns for agent read/write operations on system files.
 * Supports exact paths or glob-like prefixes ending with *.
 */
const ALLOWED_PATH_PATTERNS = [
  "/etc/caddy/Caddyfile",
  "/etc/caddy/sites/*",
  "/etc/nginx/nginx.conf",
  "/etc/nginx/sites-available/*",
  "/etc/nginx/conf.d/*",
  "/etc/hosts",
  "/etc/environment",
  "/etc/systemd/system/*",
  "/etc/init.d/*",
  "/opt/*",
  "/var/www/*",
  "/root/*",
  "/home/*",
  "/tmp/*",
];

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

/** Check whether a path is inside an allowed system location. */
export function isAllowedSystemPath(path: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized.startsWith("/")) return false;

  for (const pattern of ALLOWED_PATH_PATTERNS) {
    const pat = normalizePath(pattern);
    if (pat.endsWith("/*")) {
      const prefix = pat.slice(0, -1);
      if (normalized === prefix || normalized.startsWith(prefix)) return true;
    } else if (normalized === pat) {
      return true;
    }
  }
  return false;
}

/** Refuse traversal outside the requested path. */
export function validateSafePath(path: string): string | null {
  if (!path) return "Path is required.";
  if (!isAllowedSystemPath(path)) {
    return `Path ${path} is not in the allowed system path list.`;
  }
  if (path.includes("..") || /[~$]/.test(path)) {
    return `Path contains disallowed characters.`;
  }
  return null;
}

/**
 * Command heads permitted through run_system_command. These are system
 * administration primitives the agent may need that are not covered by
 * dedicated tools. All commands still pass through a destructive-pattern
 * deny-list and require user confirmation.
 */
const SAFE_SYSTEM_COMMAND_HEADS = new Set([
  "systemctl",
  "service",
  "rc-service",
  "rc-update",
  "rc-status",
  "apt",
  "apt-get",
  "apk",
  "dnf",
  "yum",
  "pacman",
  "ufw",
  "iptables",
  "nft",
  "sysctl",
  "timedatectl",
  "hostnamectl",
  "update-alternatives",
  "dpkg-reconfigure",
  "usermod",
  "groupmod",
  "passwd",
  "chpasswd",
  "adduser",
  "addgroup",
  "ip",
  "ss",
  "netstat",
  "lsof",
  "lsblk",
  "fdisk",
  "parted",
]);

/**
 * Patterns that are never allowed through run_system_command. Focused on
 * destructive, irreversible, or exfiltration-prone operations.
 */
const DANGEROUS_SYSTEM_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\b/, reason: "file deletion (rm)" },
  { re: /\brmdir\b/, reason: "directory deletion (rmdir)" },
  { re: /\bdd\b/, reason: "raw disk write (dd)" },
  { re: /\bmkfs\b/, reason: "filesystem creation (mkfs)" },
  { re: /\bshutdown\b/, reason: "shutdown" },
  { re: /\breboot\b/, reason: "reboot" },
  { re: /\bhalt\b/, reason: "halt" },
  { re: /\bpoweroff\b/, reason: "poweroff" },
  { re: /\binit\s+0\b/, reason: "init 0/6" },
  { re: /\binit\s+6\b/, reason: "init 0/6" },
  { re: />/, reason: "output redirection / file writing (>))" },
  { re: /\btee\b/, reason: "file writing (tee)" },
  { re: /\bwget\b[\s\S]*\|[\s\S]*\b(sh|bash)\b/, reason: "wget|sh remote execution" },
  { re: /\bcurl\b[\s\S]*\|[\s\S]*\b(sh|bash)\b/, reason: "curl|sh remote execution" },
  { re: /\beval\b/, reason: "eval" },
  { re: /\bsudo\b/, reason: "privilege escalation (sudo)" },
  { re: /\bsu\b\s/, reason: "user switching (su)" },
  { re: /\bnc\b|\bnetcat\b|\bncat\b/, reason: "network shells (netcat)" },
  { re: /\bcrontab\b/, reason: "cron modification (use dedicated tooling)" },
];

/**
 * Validate a run_system_command command. Returns null if allowed, otherwise a
 * human-readable refusal reason.
 */
export function validateSystemCommand(command: string): string | null {
  const cmd = (command || "").trim();
  if (!cmd) return "Empty command.";

  for (const { re, reason } of DANGEROUS_SYSTEM_PATTERNS) {
    if (re.test(cmd)) {
      return `Refused: command appears to perform a disallowed operation (${reason}).`;
    }
  }

  const segments = cmd.split(/(?:\|\||&&|[;|])/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const head = trimmed.split(/\s+/)[0].replace(/^.*\//, "");
    if (!SAFE_SYSTEM_COMMAND_HEADS.has(head)) {
      return `Refused: "${head}" is not in the system-command allow-list. Use dedicated tools for Docker, compose, containers, files, and diagnostics.`;
    }
  }

  return null;
}

/** Quote a path safely for shell use. */
export function quotePath(path: string): string {
  return shQuote(path);
}
