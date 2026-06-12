import { execOnVps, VpsConnection, shQuote } from "./vps";

export interface ServerLayout {
  osFamily: "alpine" | "debian" | "other";
  osName: string;
  osVersion: string;
  dockerAvailable: boolean;
  composeCommand: string;
  projectRoot: string;
  caddySitesDir: string;
  caddyFile: string;
  nginxSitesDir: string;
  nginxLogPath: string;
  staticRoot: string;
  sshDefaultCwd: string;
}

const DEFAULT_LAYOUT: ServerLayout = {
  osFamily: "other",
  osName: "unknown",
  osVersion: "",
  dockerAvailable: false,
  composeCommand: "docker compose",
  projectRoot: "/opt",
  caddySitesDir: "/etc/caddy/sites",
  caddyFile: "/etc/caddy/Caddyfile",
  nginxSitesDir: "/etc/nginx/sites-available",
  nginxLogPath: "/var/log/nginx/error.log",
  staticRoot: "/var/www",
  sshDefaultCwd: "/root",
};

function normalizeOsId(id: string): "alpine" | "debian" | "other" {
  const lower = id.toLowerCase();
  if (lower.includes("alpine")) return "alpine";
  if (lower.includes("debian") || lower.includes("ubuntu")) return "debian";
  return "other";
}

async function readOsRelease(vps?: VpsConnection | null): Promise<{ id: string; name: string; version: string }> {
  const result = await execOnVps(
    `cat /etc/os-release 2>/dev/null || echo 'ID=unknown\nPRETTY_NAME=unknown\nVERSION_ID='`,
    vps
  );
  let id = "unknown";
  let name = "unknown";
  let version = "";
  for (const line of result.stdout.split("\n")) {
    const m = line.match(/^ID=(.*)$/);
    if (m) id = m[1].replace(/^["']|["']$/g, "").trim();
    const n = line.match(/^PRETTY_NAME=(.*)$/);
    if (n) name = n[1].replace(/^["']|["']$/g, "").trim();
    const v = line.match(/^VERSION_ID=(.*)$/);
    if (v) version = v[1].replace(/^["']|["']$/g, "").trim();
  }
  return { id, name, version };
}

async function detectComposeCommand(vps?: VpsConnection | null): Promise<string> {
  const candidates = [
    { cmd: "docker compose version", value: "docker compose" },
    { cmd: "docker-compose version", value: "docker-compose" },
    { cmd: "podman-compose version", value: "podman-compose" },
  ];
  for (const candidate of candidates) {
    const result = await execOnVps(`${candidate.cmd} 2>/dev/null || echo ""`, vps);
    if (result.code === 0 && result.stdout.toLowerCase().includes("compose")) {
      return candidate.value;
    }
  }
  // Fallback: check binary existence even if `version` fails
  const which = await execOnVps(
    `command -v docker-compose 2>/dev/null || echo ""`,
    vps
  );
  if (which.stdout.trim()) return "docker-compose";
  return "docker compose";
}

async function detectProjectRoot(vps?: VpsConnection | null): Promise<string> {
  const candidates = ["/opt", "/var/www", "/home"];
  for (const dir of candidates) {
    const result = await execOnVps(`test -d ${shQuote(dir)} && echo ${shQuote(dir)} || echo ""`, vps);
    if (result.stdout.trim()) return dir;
  }
  return "/opt";
}

async function detectCaddySitesDir(vps?: VpsConnection | null): Promise<string> {
  const result = await execOnVps(
    `test -d /etc/caddy/sites && echo /etc/caddy/sites || echo /etc/caddy`,
    vps
  );
  return result.stdout.trim() || "/etc/caddy";
}

async function detectNginxSitesDir(vps?: VpsConnection | null): Promise<string> {
  const result = await execOnVps(
    `test -d /etc/nginx/sites-available && echo /etc/nginx/sites-available || echo /etc/nginx/conf.d`,
    vps
  );
  return result.stdout.trim() || "/etc/nginx/conf.d";
}

async function detectStaticRoot(vps?: VpsConnection | null): Promise<string> {
  const result = await execOnVps(
    `test -d /var/www && echo /var/www || echo ""`,
    vps
  );
  return result.stdout.trim() || "/var/www";
}

async function detectSshDefaultCwd(vps?: VpsConnection | null): Promise<string> {
  const result = await execOnVps(
    `u=$(whoami 2>/dev/null || echo root); if [ "$u" = "root" ]; then echo /root; else echo /home/$u; fi`,
    vps
  );
  return result.stdout.trim() || "/root";
}

async function detectDockerAvailable(vps?: VpsConnection | null): Promise<boolean> {
  const result = await execOnVps(`docker --version 2>/dev/null >/dev/null && echo yes || echo no`, vps);
  return result.stdout.trim() === "yes";
}

/**
 * Probe a VPS (or the active VPS) for filesystem layout and available tooling.
 *
 * Runs only safe, read-only commands. Commands are POSIX sh / BusyBox compatible
 * (no bash-isms) so they work on Alpine as well as Debian/Ubuntu.
 */
export async function probeServerLayout(vps?: VpsConnection | null): Promise<ServerLayout> {
  try {
    const os = await readOsRelease(vps);
    const [
      dockerAvailable,
      composeCommand,
      projectRoot,
      caddySitesDir,
      nginxSitesDir,
      staticRoot,
      sshDefaultCwd,
    ] = await Promise.all([
      detectDockerAvailable(vps),
      detectComposeCommand(vps),
      detectProjectRoot(vps),
      detectCaddySitesDir(vps),
      detectNginxSitesDir(vps),
      detectStaticRoot(vps),
      detectSshDefaultCwd(vps),
    ]);

    return {
      osFamily: normalizeOsId(os.id),
      osName: os.name || os.id,
      osVersion: os.version,
      dockerAvailable,
      composeCommand,
      projectRoot,
      caddySitesDir,
      caddyFile: "/etc/caddy/Caddyfile",
      nginxSitesDir,
      nginxLogPath: "/var/log/nginx/error.log",
      staticRoot,
      sshDefaultCwd,
    };
  } catch (err) {
    // Degrade gracefully: callers decide whether to surface the error.
    return { ...DEFAULT_LAYOUT, osName: `probe error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
