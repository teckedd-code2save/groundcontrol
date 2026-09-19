import { isIP } from "node:net";
import { resolve4 } from "node:dns/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decryptMaybe, encryptIfNeeded } from "@/lib/crypto";
import {
  createDnsRecord,
  createTunnel,
  getActiveCloudflareAccount,
  listDnsRecords,
  listZones,
  updateDnsRecord,
  updateTunnelConfiguration,
  verifyCloudflareToken,
  type CloudflareAccountRecord,
} from "@/lib/cloudflare";
import { execOnHost } from "@/lib/host-exec";
import { installClaimStatus } from "@/lib/install-claim";
import { prisma } from "@/lib/prisma";
import { shQuote } from "@/lib/vps";

const execFileAsync = promisify(execFile);

const PUBLIC_URL_KEY = "groundcontrol_public_url";
const PUBLISH_MODE_KEY = "groundcontrol_publish_mode";
const PUBLISH_EVIDENCE_KEY = "groundcontrol_publish_evidence";
const QUICK_TUNNEL_CONTAINER = "groundcontrol-quick-tunnel";
const NAMED_TUNNEL_NAME = "groundcontrol-instance";

export type PublishMode = "private" | "caddy" | "cloudflare" | "quick_tunnel";

export type VerificationCheck = {
  status: "ready" | "failed" | "skipped";
  detail: string;
};

export type InstanceVerification = {
  ok: boolean;
  publicUrl: string | null;
  checkedAt: string;
  checks: {
    container: VerificationCheck;
    storage: VerificationCheck;
    hostExecution: VerificationCheck;
    terminalPty: VerificationCheck;
    mcpDiscovery: VerificationCheck;
    oauthMetadata: VerificationCheck;
    claimBoundary: VerificationCheck;
    publicHttps: VerificationCheck;
  };
};

export function normalizePublicHostname(value: string) {
  const hostname = value.trim().toLowerCase().replace(/.$/, "");
  if (
    hostname.length < 3 ||
    hostname.length > 253 ||
    hostname === "localhost" ||
    isIP(hostname) !== 0
  ) {
    throw new Error("Enter a public DNS hostname, not an IP address.");
  }
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error("Enter a valid public DNS hostname.");
  }
  return hostname;
}

async function setConfig(key: string, value: string) {
  await prisma.appConfig.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function getConfig(key: string) {
  return (await prisma.appConfig.findUnique({ where: { key } }))?.value || "";
}

async function groundControlHostPort() {
  const result = await execOnHost(
    "docker port groundcontrol-web 3000/tcp 2>/dev/null | head -n 1",
    { requireHost: true }
  );
  if (result.code !== 0) {
    throw new Error("Could not resolve GroundControl's loopback host port.");
  }
  const match = result.stdout.trim().match(/:(\d+)$/);
  const port = Number(match?.[1] || 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("GroundControl's host port could not be determined.");
  }
  return port;
}

async function groundControlDockerNetwork() {
  const result = await execOnHost(
    "docker inspect groundcontrol-web --format '{{json .NetworkSettings.Networks}}' 2>/dev/null",
    { requireHost: true }
  );
  let network = "";
  try {
    const networks = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    network = Object.keys(networks)[0] || "";
  } catch {}
  if (!network || !/^[A-Za-z0-9_.-]+$/.test(network)) {
    throw new Error("Could not resolve GroundControl's Docker network.");
  }
  return network;
}

async function stopQuickTunnel() {
  await execOnHost(
    `docker rm -f ${shQuote(QUICK_TUNNEL_CONTAINER)} >/dev/null 2>&1 || true`,
    { requireHost: true }
  );
}

async function activeNamedTunnelRow() {
  return prisma.cloudflareTunnel.findFirst({
    where: { name: NAMED_TUNNEL_NAME },
    orderBy: { updatedAt: "desc" },
  });
}

async function findZoneForHostname(
  hostname: string,
  account: CloudflareAccountRecord
) {
  const zones = await listZones(account);
  const candidates = zones
    .map((zone) => ({
      id: String(zone.id || ""),
      name: String(zone.name || "").toLowerCase(),
    }))
    .filter((zone) => zone.id && zone.name)
    .filter((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`))
    .sort((a, b) => b.name.length - a.name.length);
  if (!candidates[0]) {
    throw new Error(
      `No Cloudflare zone in the active account owns ${hostname}. Add the zone or use direct Caddy publishing.`
    );
  }
  return candidates[0];
}

async function ensureTunnelDns(
  account: CloudflareAccountRecord,
  zoneId: string,
  hostname: string,
  tunnelId: string
) {
  const target = `${tunnelId}.cfargotunnel.com`;
  const records = await listDnsRecords(zoneId, account);
  const existing = records.find(
    (record) => String(record.name || "").toLowerCase() === hostname
  );
  const data = {
    type: "CNAME" as const,
    name: hostname,
    content: target,
    ttl: 1,
    proxied: true,
    comment: "GroundControl management plane",
  };
  if (existing?.id) {
    await updateDnsRecord(zoneId, String(existing.id), data, account);
  } else {
    await createDnsRecord(zoneId, data, account);
  }
  return target;
}

async function startNamedTunnelConnector(
  connectorName: string,
  tunnelToken: string
) {
  const network = await groundControlDockerNetwork();
  const command = [
    `docker rm -f ${shQuote(connectorName)} >/dev/null 2>&1 || true`,
    "&& docker run -d",
    `--name ${shQuote(connectorName)}`,
    "--restart unless-stopped",
    `--network ${shQuote(network)}`,
    "cloudflare/cloudflared:latest",
    "tunnel run --token",
    shQuote(tunnelToken),
  ].join(" ");
  const result = await execOnHost(command, { requireHost: true });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "Could not start Cloudflare Tunnel connector.");
  }
}

async function saveActiveCloudflareAccount(input: {
  apiToken: string;
  accountId?: string;
}) {
  const token = input.apiToken.trim();
  if (!token) throw new Error("Cloudflare API token is required.");
  await verifyCloudflareToken({ apiToken: token });

  let accountId = String(input.accountId || "").trim();
  if (!accountId) {
    const response = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json() as {
      success?: boolean;
      result?: Array<{ id?: string; name?: string }>;
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || payload.success === false) {
      throw new Error(
        payload.errors?.map((item) => item.message).filter(Boolean).join("; ") ||
        "Could not discover Cloudflare account."
      );
    }
    const accounts = Array.isArray(payload.result) ? payload.result.filter((item) => item.id) : [];
    if (accounts.length !== 1) {
      throw new Error(
        accounts.length === 0
          ? "The Cloudflare token does not expose an account."
          : "This token exposes multiple Cloudflare accounts. Provide the account ID to use."
      );
    }
    accountId = String(accounts[0].id);
  }

  const encrypted = encryptIfNeeded(token);
  if (!encrypted) throw new Error("Could not encrypt Cloudflare token.");

  const existing = await prisma.cloudflareAccount.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  const account = existing
    ? await prisma.cloudflareAccount.update({
        where: { id: existing.id },
        data: {
          name: existing.name || "Cloudflare",
          apiToken: encrypted,
          accountId,
          isActive: true,
        },
      })
    : await prisma.cloudflareAccount.create({
        data: {
          name: "Cloudflare",
          apiToken: encrypted,
          accountId,
          isActive: true,
        },
      });

  await prisma.cloudflareAccount.updateMany({
    where: { id: { not: account.id }, isActive: true },
    data: { isActive: false },
  });

  return {
    ...account,
    apiToken: token,
  } satisfies CloudflareAccountRecord;
}

export async function publishWithCloudflare(input: {
  hostname: string;
  apiToken?: string;
  accountId?: string;
}) {
  const hostname = normalizePublicHostname(input.hostname);
  await stopQuickTunnel();

  let account = await getActiveCloudflareAccount();
  if (!account && input.apiToken) {
    account = await saveActiveCloudflareAccount({
      apiToken: input.apiToken,
      accountId: input.accountId,
    });
  }
  if (!account) {
    throw new Error(
      "Connect Cloudflare first or provide an API token for this one-time setup."
    );
  }

  const zone = await findZoneForHostname(hostname, account);
  let row = await activeNamedTunnelRow();
  let tunnelId = row?.tunnelId || "";
  let token = decryptMaybe(row?.tunnelSecret) || "";

  if (!row || !tunnelId || !token) {
    const created = await createTunnel(NAMED_TUNNEL_NAME, account);
    tunnelId = String(created.tunnel.id || "");
    token = created.token;
    if (!tunnelId || !token) {
      throw new Error("Cloudflare did not return a usable tunnel.");
    }
  }

  await updateTunnelConfiguration(
    tunnelId,
    [{ hostname, service: "http://groundcontrol-web:3000" }],
    account
  );
  await ensureTunnelDns(account, zone.id, hostname, tunnelId);

  const connectorId = `gc-control-plane-${tunnelId.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 18)}`;
  await startNamedTunnelConnector(connectorId, token);

  row = await prisma.cloudflareTunnel.upsert({
    where: { tunnelId },
    create: {
      tunnelId,
      name: NAMED_TUNNEL_NAME,
      tunnelSecret: encryptIfNeeded(token),
      connectorId,
      status: "active",
      domains: hostname,
      configJson: JSON.stringify({
        purpose: "groundcontrol-management-plane",
        hostname,
        service: "http://groundcontrol-web:3000",
      }),
      cloudflareAccountId: account.id,
    },
    update: {
      connectorId,
      status: "active",
      domains: hostname,
      configJson: JSON.stringify({
        purpose: "groundcontrol-management-plane",
        hostname,
        service: "http://groundcontrol-web:3000",
      }),
      cloudflareAccountId: account.id,
    },
  });

  const publicUrl = `https://${hostname}`;
  await setConfig(PUBLIC_URL_KEY, publicUrl);
  await setConfig(PUBLISH_MODE_KEY, "cloudflare");

  return {
    mode: "cloudflare" as const,
    publicUrl,
    tunnelId: row.tunnelId,
    hostname,
    zone: zone.name,
  };
}

async function currentPublicIpv4() {
  const result = await execOnHost(
    "curl -4 -fsS --max-time 8 https://api.ipify.org || curl -4 -fsS --max-time 8 https://ifconfig.co/ip",
    { requireHost: true }
  );
  const value = result.stdout.trim();
  if (isIP(value) !== 4) throw new Error("Could not determine this VPS public IPv4 address.");
  return value;
}

async function ensureCaddyInstalled() {
  const check = await execOnHost(
    "command -v caddy >/dev/null 2>&1 && caddy version || true",
    { requireHost: true }
  );
  if (check.stdout.trim()) return;

  const os = await execOnHost(
    ". /etc/os-release 2>/dev/null || true; printf '%s' "${ID:-unknown}"",
    { requireHost: true }
  );
  const family = os.stdout.trim().toLowerCase();

  let command = "";
  if (family === "ubuntu" || family === "debian") {
    command = [
      "apt-get update",
      "apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg",
      "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg",
      "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list",
      "apt-get update",
      "apt-get install -y caddy",
    ].join(" && ");
  } else if (family === "alpine") {
    command = "apk add --no-cache caddy";
  } else {
    throw new Error(
      "Automatic Caddy installation currently supports Debian, Ubuntu and Alpine. Use Cloudflare Tunnel or install Caddy first."
    );
  }

  const result = await execOnHost(command, { requireHost: true });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "Caddy installation failed.");
  }
}

async function configureCaddy(hostname: string, port: number) {
  const config = [
    `${hostname} {`,
    `  reverse_proxy 127.0.0.1:${port}`,
    "  encode zstd gzip",
    "}",
    "",
  ].join("\n");

  const command = [
    "set -eu",
    "mkdir -p /etc/caddy/sites",
    "touch /etc/caddy/Caddyfile",
    "cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.gc-before-publish",
    "grep -Fq 'import /etc/caddy/sites/*' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/sites/*\n' >> /etc/caddy/Caddyfile",
    `cat > /etc/caddy/sites/groundcontrol.caddy <<'GC_CADDY'\n${config}GC_CADDY`,
    "caddy validate --config /etc/caddy/Caddyfile",
    "(caddy reload --config /etc/caddy/Caddyfile || systemctl reload caddy || rc-service caddy restart)",
  ].join("\n");

  const result = await execOnHost(command, { requireHost: true });
  if (result.code !== 0) {
    await execOnHost(
      "test -f /etc/caddy/Caddyfile.gc-before-publish && cp /etc/caddy/Caddyfile.gc-before-publish /etc/caddy/Caddyfile || true",
      { requireHost: true }
    );
    throw new Error(result.stderr || result.stdout || "Caddy configuration failed.");
  }
}

export async function publishWithCaddy(input: { hostname: string }) {
  const hostname = normalizePublicHostname(input.hostname);
  await stopQuickTunnel();

  const originIp = await currentPublicIpv4();
  let resolved: string[] = [];
  try {
    resolved = await resolve4(hostname);
  } catch {
    resolved = [];
  }
  if (!resolved.includes(originIp)) {
    const error = new Error(
      `DNS is not pointing ${hostname} at this VPS yet. Create an A record for ${hostname} → ${originIp}, then retry.`
    ) as Error & { code?: string; requiredRecord?: Record<string, string> };
    error.code = "DNS_REQUIRED";
    error.requiredRecord = { type: "A", name: hostname, content: originIp };
    throw error;
  }

  await ensureCaddyInstalled();
  const port = await groundControlHostPort();
  await configureCaddy(hostname, port);

  const publicUrl = `https://${hostname}`;
  await setConfig(PUBLIC_URL_KEY, publicUrl);
  await setConfig(PUBLISH_MODE_KEY, "caddy");

  return {
    mode: "caddy" as const,
    publicUrl,
    hostname,
    originIp,
  };
}

export async function publishQuickTunnel() {
  const network = await groundControlDockerNetwork();
  await stopQuickTunnel();

  const command = [
    "docker run -d",
    `--name ${shQuote(QUICK_TUNNEL_CONTAINER)}`,
    "--restart unless-stopped",
    `--network ${shQuote(network)}`,
    "cloudflare/cloudflared:latest",
    "tunnel --no-autoupdate --url http://groundcontrol-web:3000",
  ].join(" ");
  const started = await execOnHost(command, { requireHost: true });
  if (started.code !== 0) {
    throw new Error(started.stderr || started.stdout || "Could not start temporary HTTPS bridge.");
  }

  const probe = await execOnHost(
    [
      "i=0",
      "while [ $i -lt 25 ]; do",
      `  url=$(docker logs ${shQuote(QUICK_TUNNEL_CONTAINER)} 2>&1 | grep -Eo 'https://[A-Za-z0-9-]+\\.trycloudflare\\.com' | tail -n 1 || true)`,
      "  if [ -n "$url" ]; then printf '%s' "$url"; exit 0; fi",
      "  i=$((i+1)); sleep 1",
      "done",
      `docker logs --tail 80 ${shQuote(QUICK_TUNNEL_CONTAINER)} >&2 || true`,
      "exit 1",
    ].join("\n"),
    { requireHost: true }
  );
  const publicUrl = probe.stdout.trim().match(/https:\/\/[A-Za-z0-9-]+\.trycloudflare\.com/)?.[0] || "";
  if (probe.code !== 0 || !publicUrl) {
    throw new Error(probe.stderr || "Temporary HTTPS bridge did not return a public URL.");
  }

  await setConfig(PUBLIC_URL_KEY, publicUrl);
  await setConfig(PUBLISH_MODE_KEY, "quick_tunnel");

  return {
    mode: "quick_tunnel" as const,
    publicUrl,
    temporary: true,
  };
}

export async function keepInstancePrivate() {
  await stopQuickTunnel();
  await setConfig(PUBLIC_URL_KEY, "");
  await setConfig(PUBLISH_MODE_KEY, "private");
  return {
    mode: "private" as const,
    publicUrl: null,
  };
}

async function httpCheck(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        ...(init?.headers || {}),
      },
    });
    const text = await response.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : null; } catch {}
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

function check(status: boolean, ready: string, failed: string): VerificationCheck {
  return status
    ? { status: "ready", detail: ready }
    : { status: "failed", detail: failed };
}

export async function verifyGroundControlInstance(
  explicitPublicUrl?: string | null
): Promise<InstanceVerification> {
  const publicUrl = String(explicitPublicUrl ?? await getConfig(PUBLIC_URL_KEY)).replace(/\/$/, "") || null;
  const checkedAt = new Date().toISOString();

  const [containerResult, storageResult, hostResult, claim] = await Promise.all([
    execOnHost(
      "test "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' groundcontrol-web 2>/dev/null)" = healthy && echo ready || echo failed",
      { requireHost: true }
    ),
    execOnHost(
      "docker inspect groundcontrol-web --format '{{range .Mounts}}{{if eq .Destination "/app/prisma"}}{{.Type}}:{{.Name}}{{end}}{{end}}' 2>/dev/null",
      { requireHost: true }
    ),
    execOnHost("printf groundcontrol-host-ok", { requireHost: true }),
    installClaimStatus(),
  ]);

  let ptyReady = false;
  let ptyDetail = "PTY relay could not be verified.";
  try {
    const { stdout } = await execFileAsync(
      "script",
      ["-q", "-e", "-f", "-c", "printf groundcontrol-pty-ok", "/dev/null"],
      {
        timeout: 5_000,
        env: { ...process.env, SHELL: "/bin/sh" },
      }
    );
    ptyReady = stdout.includes("groundcontrol-pty-ok");
    if (ptyReady) ptyDetail = "PTY relay is available with /bin/sh.";
  } catch (error) {
    ptyDetail = error instanceof Error ? error.message : ptyDetail;
  }

  const localBase = "http://127.0.0.1:3000";
  const [mcp, oauth] = await Promise.all([
    httpCheck(`${localBase}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "install-verification",
        method: "tools/list",
        params: {},
      }),
    }),
    httpCheck(`${localBase}/.well-known/oauth-protected-resource`),
  ]);
  const tools = (
    mcp.body &&
    typeof mcp.body === "object" &&
    "result" in mcp.body &&
    (mcp.body as { result?: { tools?: Array<{ name?: string }> } }).result?.tools
  ) || [];
  const mcpReady = mcp.ok && tools.some((tool) => tool.name === "deployment.list");
  const oauthReady = oauth.ok &&
    Boolean(
      oauth.body &&
      typeof oauth.body === "object" &&
      (oauth.body as { resource?: string }).resource
    );

  let publicHttps: VerificationCheck = {
    status: "skipped",
    detail: "Instance is private; public HTTPS was not requested.",
  };
  if (publicUrl) {
    const parsed = new URL(publicUrl);
    if (parsed.protocol !== "https:") {
      publicHttps = {
        status: "failed",
        detail: "Configured public URL is not HTTPS.",
      };
    } else {
      let publicProbe = await httpCheck(`${publicUrl}/.well-known/oauth-protected-resource`);
      for (let attempt = 0; attempt < 5 && !publicProbe.ok; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        publicProbe = await httpCheck(`${publicUrl}/.well-known/oauth-protected-resource`);
      }
      publicHttps = check(
        publicProbe.ok,
        `HTTPS and OAuth metadata are reachable at ${publicUrl}.`,
        `Could not verify HTTPS at ${publicUrl} (HTTP ${publicProbe.status || "unreachable"}).`
      );
    }
  }

  const activeClaims = await prisma.installClaim.count({ where: { status: "active" } });
  const claimReady = claim.claimed && activeClaims === 0;

  const result: InstanceVerification = {
    ok: false,
    publicUrl,
    checkedAt,
    checks: {
      container: check(
        containerResult.stdout.trim() === "ready",
        "GroundControl container is healthy.",
        "GroundControl container health is not ready."
      ),
      storage: check(
        storageResult.stdout.trim().startsWith("volume:"),
        "Database is mounted on a persistent Docker volume.",
        "Persistent /app/prisma volume was not detected."
      ),
      hostExecution: check(
        hostResult.code === 0 && hostResult.stdout === "groundcontrol-host-ok",
        "Strict host execution plane is available.",
        hostResult.stderr || "Strict host execution plane failed."
      ),
      terminalPty: check(ptyReady, ptyDetail, ptyDetail),
      mcpDiscovery: check(
        mcpReady,
        "MCP discovery exposes GroundControl deployment tools.",
        "MCP discovery did not expose deployment.list."
      ),
      oauthMetadata: check(
        oauthReady,
        "OAuth protected-resource metadata is available.",
        "OAuth protected-resource metadata is unavailable."
      ),
      claimBoundary: check(
        claimReady,
        "Instance is claimed and no bootstrap claim remains active.",
        "Human claim boundary is not complete."
      ),
      publicHttps,
    },
  };

  result.ok = Object.values(result.checks).every(
    (item) => item.status === "ready" || item.status === "skipped"
  );

  await setConfig(PUBLISH_EVIDENCE_KEY, JSON.stringify(result));
  return result;
}

export async function instancePublishStatus() {
  const [publicUrl, mode, evidence, claim, activeCloudflare] = await Promise.all([
    getConfig(PUBLIC_URL_KEY),
    getConfig(PUBLISH_MODE_KEY),
    getConfig(PUBLISH_EVIDENCE_KEY),
    installClaimStatus(),
    getActiveCloudflareAccount(),
  ]);

  let lastVerification: InstanceVerification | null = null;
  try {
    lastVerification = evidence ? JSON.parse(evidence) as InstanceVerification : null;
  } catch {}

  return {
    mode: (mode || "private") as PublishMode,
    publicUrl: publicUrl || null,
    claimed: claim.claimed,
    cloudflareConfigured: Boolean(activeCloudflare),
    cloudflareAccountId: activeCloudflare?.accountId || null,
    lastVerification,
  };
}
