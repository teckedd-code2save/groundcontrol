import { execOnVps, shQuote, type VpsConnection, getActiveVps } from "./vps";

async function detectOsFamily(vps?: VpsConnection | null): Promise<"alpine" | "debian" | "other"> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return "other";
  const result = await execOnVps("cat /etc/os-release 2>/dev/null || echo 'ID=unknown'", conn);
  const id = result.stdout
    .split("\n")
    .find((l) => l.startsWith("ID="))
    ?.replace(/^ID=/, "")
    .replace(/["']/g, "")
    .toLowerCase() || "unknown";
  if (id.includes("alpine")) return "alpine";
  if (id.includes("debian") || id.includes("ubuntu")) return "debian";
  return "other";
}

export interface BootstrapResult {
  success: boolean;
  output: string;
  error: string;
}

/**
 * Install Docker using the official convenience script when possible,
 * falling back to distribution package managers.
 */
export async function installDocker(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const os = await detectOsFamily(conn);

  if (os === "alpine") {
    const result = await execOnVps("apk add --no-cache docker docker-cli-compose 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  if (os === "debian") {
    const script = `curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh 2>&1`;
    const result = await execOnVps(script, conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  // Generic fallback: try the official script.
  const script = `curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh 2>&1`;
  const result = await execOnVps(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install Caddy via the official repository for Debian/Ubuntu/Alpine,
 * or download the static binary as a last resort.
 */
export async function installCaddy(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const os = await detectOsFamily(conn);

  if (os === "debian") {
    const script = `apt-get install -y debian-keyring debian-archive-keyring apt-transport-https && \
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && \
apt-get update && apt-get install -y caddy 2>&1`;
    const result = await execOnVps(script, conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  if (os === "alpine") {
    const result = await execOnVps("apk add --no-cache caddy 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  // Static binary fallback.
  const arch = await execOnVps("uname -m", conn);
  const goArch = arch.stdout.trim() === "aarch64" ? "arm64" : arch.stdout.trim() === "x86_64" ? "amd64" : arch.stdout.trim();
  const script = `curl -Lo /usr/local/bin/caddy "https://github.com/caddyserver/caddy/releases/latest/download/caddy_linux_${shQuote(goArch)}" && \
chmod +x /usr/local/bin/caddy && /usr/local/bin/caddy version 2>&1`;
  const result = await execOnVps(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Pull the cloudflared Docker image so a connector container can be started later.
 */
export async function installCloudflared(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const result = await execOnVps("docker pull cloudflare/cloudflared:latest 2>&1", conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install Node.js via the official NodeSource repository (Debian/Ubuntu) or apk (Alpine).
 */
export async function installNode(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const os = await detectOsFamily(conn);

  if (os === "debian") {
    const script = `curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs 2>&1`;
    const result = await execOnVps(script, conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  if (os === "alpine") {
    const result = await execOnVps("apk add --no-cache nodejs npm 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  // Generic fallback: try NodeSource script.
  const script = `curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs 2>&1`;
  const result = await execOnVps(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

export async function getServerIp(vps?: VpsConnection | null): Promise<string> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return "";
  const res = await execOnVps(
    `hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1 2>/dev/null | awk '{print $7; exit}' || echo ""`,
    conn
  );
  return res.stdout.trim();
}

export async function isDockerInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnVps("docker --version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isCaddyInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnVps("caddy version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isNodeInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnVps("node --version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function getCloudflaredContainerStatus(
  connectorName: string,
  vps?: VpsConnection | null
): Promise<{ running: boolean; status?: string }> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { running: false };
  const res = await execOnVps(
    `docker ps --filter "name=${shQuote(connectorName)}" --format "{{.Names}}|{{.Status}}|{{.State}}" 2>/dev/null || echo ""`,
    conn
  );
  const line = res.stdout.trim().split("\n")[0];
  if (!line) return { running: false };
  const [, status, state] = line.split("|");
  return { running: state === "running", status };
}

export async function startCloudflaredConnector(
  connectorName: string,
  tunnelToken: string,
  vps?: VpsConnection | null
): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const cmd = [
    "docker rm -f",
    shQuote(connectorName),
    "2>/dev/null || true",
    "&&",
    "docker run -d --name",
    shQuote(connectorName),
    "--restart unless-stopped",
    "cloudflare/cloudflared:latest",
    "tunnel run --token",
    shQuote(tunnelToken),
  ].join(" ");
  const result = await execOnVps(cmd, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

export async function stopCloudflaredConnector(
  connectorName: string,
  vps?: VpsConnection | null
): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };
  const cmd = `docker stop ${shQuote(connectorName)} 2>/dev/null || true && docker rm ${shQuote(connectorName)} 2>/dev/null || true`;
  const result = await execOnVps(cmd, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/** @deprecated Use startCloudflaredConnector with a pre-fetched tunnel token. */
export async function runCloudflaredConnector(
  connectorName: string,
  tunnelId: string,
  tunnelSecret: string,
  vps?: VpsConnection | null
): Promise<BootstrapResult> {
  const token = Buffer.from(JSON.stringify({ a: tunnelId, s: tunnelSecret, id: tunnelId })).toString("base64url");
  return startCloudflaredConnector(connectorName, token, vps);
}
