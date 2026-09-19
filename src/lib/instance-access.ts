import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "@/lib/prisma";
import { encryptIfNeeded, decryptMaybe } from "@/lib/crypto";
import {
  createDnsRecord,
  createTunnel,
  getActiveCloudflareAccount,
  listDnsRecords,
  listZones,
  updateDnsRecord,
  updateTunnelConfiguration,
} from "@/lib/cloudflare";
import { ensureGroundControlInstanceId } from "@/lib/install-claim";
import { execOnHost, execOnTargetStrict } from "@/lib/host-exec";
import { getActiveVps, shQuote } from "@/lib/vps";

const ACCESS_CONFIG_KEY = "groundcontrol_instance_access";
const QUICK_CONTAINER = "gc-instance-quick-tunnel";
const NAMED_CONTAINER = "gc-instance-access";
const LOCAL_ORIGIN = "http://127.0.0.1:3000";

export type InstanceAccessMode = "private" | "quick_tunnel" | "cloudflare_domain";

export type InstanceAccessCheck = {
  id: "container" | "host_exec" | "pty" | "https" | "oauth" | "mcp" | "storage";
  label: string;
  ok: boolean;
  detail: string;
};

export type InstanceAccessState = {
  mode: InstanceAccessMode;
  publicUrl: string | null;
  domain: string | null;
  temporary: boolean;
  verifiedAt: string | null;
  tunnelId?: string | null;
  connector?: string | null;
  checks?: InstanceAccessCheck[];
};

const PRIVATE_STATE: InstanceAccessState = {
  mode: "private",
  publicUrl: null,
  domain: null,
  temporary: false,
  verifiedAt: null,
};

function parseState(value: string | null | undefined): InstanceAccessState {
  if (!value) return PRIVATE_STATE;
  try {
    const parsed = JSON.parse(value) as Partial<InstanceAccessState>;
    if (!["private", "quick_tunnel", "cloudflare_domain"].includes(String(parsed.mode))) {
      return PRIVATE_STATE;
    }
    return {
      mode: parsed.mode as InstanceAccessMode,
      publicUrl: typeof parsed.publicUrl === "string" ? parsed.publicUrl : null,
      domain: typeof parsed.domain === "string" ? parsed.domain : null,
      temporary: Boolean(parsed.temporary),
      verifiedAt: typeof parsed.verifiedAt === "string" ? parsed.verifiedAt : null,
      tunnelId: typeof parsed.tunnelId === "string" ? parsed.tunnelId : null,
      connector: typeof parsed.connector === "string" ? parsed.connector : null,
      checks: Array.isArray(parsed.checks) ? parsed.checks : undefined,
    };
  } catch {
    return PRIVATE_STATE;
  }
}

async function saveState(state: InstanceAccessState) {
  await prisma.appConfig.upsert({
    where: { key: ACCESS_CONFIG_KEY },
    create: { key: ACCESS_CONFIG_KEY, value: JSON.stringify(state) },
    update: { value: JSON.stringify(state) },
  });
  return state;
}

function normalizeDomain(value: string) {
  const raw = String(value || "").trim().toLowerCase().replace(/.$/, "");
  if (!raw || raw.length > 253) throw new Error("Enter a valid domain name.");
  if (
    raw === "localhost" ||
    !raw.includes(".") ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(raw)
  ) {
    throw new Error("Enter a valid public domain name.");
  }
  return raw;
}

async function dockerRunCloudflared(name: string, args: string[]) {
  const command = [
    `docker rm -f ${shQuote(name)} >/dev/null 2>&1 || true`,
    "&&",
    "docker run -d",
    "--name",
    shQuote(name),
    "--restart unless-stopped",
    "--network",
    "container:groundcontrol-web",
    "cloudflare/cloudflared:latest",
    ...args.map(shQuote),
  ].join(" ");
  const result = await execOnHost(command, { requireHost: true });
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "Could not start cloudflared").trim());
  }
  return result.stdout.trim();
}

async function stopConnector(name: string) {
  await execOnHost(
    `docker rm -f ${shQuote(name)} >/dev/null 2>&1 || true`,
    { requireHost: true }
  );
}

async function quickTunnelUrl() {
  const logs = await execOnHost(
    `docker logs ${shQuote(QUICK_CONTAINER)} 2>&1 | tail -n 160`,
    { requireHost: true }
  );
  const matches = logs.stdout.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi);
  return matches?.at(-1) || null;
}

async function waitForQuickTunnelUrl() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const url = await quickTunnelUrl();
    if (url) return url;
    await delay(750);
  }
  throw new Error("Cloudflare quick tunnel started but did not publish an HTTPS URL.");
}

async function publicJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 800); }
  return { response, body };
}

async function waitForPublicOrigin(origin: string) {
  let last = "not checked";
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const { response } = await publicJson(`${origin}/api/auth/claim`);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(1_200);
  }
  throw new Error(`Public HTTPS endpoint did not become ready: ${last}`);
}

export async function verifyInstanceAccess(publicUrl?: string | null): Promise<InstanceAccessCheck[]> {
  const checks: InstanceAccessCheck[] = [];

  const container = await execOnHost(
    "docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' groundcontrol-web 2>/dev/null || true",
    { requireHost: true }
  );
  const containerState = container.stdout.trim();
  checks.push({
    id: "container",
    label: "GroundControl container",
    ok: containerState === "healthy" || containerState === "running",
    detail: containerState || "container not found",
  });

  const active = await getActiveVps().catch(() => null);
  const hostExec = active
    ? await execOnTargetStrict("printf gc-host-ok", active).catch((error) => ({
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        code: 1,
      }))
    : { stdout: "", stderr: "No active local target", code: 1 };
  checks.push({
    id: "host_exec",
    label: "Host execution",
    ok: hostExec.code === 0 && hostExec.stdout.includes("gc-host-ok"),
    detail: hostExec.code === 0 ? "Host execution plane verified." : (hostExec.stderr || "Host execution failed").slice(0, 220),
  });

  const pty = await execOnHost(
    `docker exec -e SHELL=/bin/sh groundcontrol-web script -q -e -f -c "printf gc-pty-ok" /dev/null 2>/dev/null || true`,
    { requireHost: true }
  );
  checks.push({
    id: "pty",
    label: "PTY relay",
    ok: pty.stdout.includes("gc-pty-ok"),
    detail: pty.stdout.includes("gc-pty-ok") ? "Native terminal relay verified." : "PTY relay probe failed.",
  });

  const instanceId = await ensureGroundControlInstanceId();
  const persisted = await prisma.appConfig.findUnique({ where: { key: "groundcontrol_instance_id" } });
  checks.push({
    id: "storage",
    label: "Persistent instance state",
    ok: persisted?.value === instanceId,
    detail: persisted?.value === instanceId ? `Instance ${instanceId.slice(0, 14)} persisted.` : "Instance identity could not be re-read.",
  });

  if (!publicUrl) return checks;

  const origin = new URL(publicUrl);
  if (origin.protocol !== "https:") throw new Error("Public GroundControl access must use HTTPS.");
  const base = origin.origin.replace(/\/$/, "");

  try {
    const { response } = await publicJson(`${base}/api/auth/claim`);
    checks.push({
      id: "https",
      label: "Public HTTPS",
      ok: response.ok,
      detail: response.ok ? `${base} is reachable.` : `Public endpoint returned HTTP ${response.status}.`,
    });
  } catch (error) {
    checks.push({
      id: "https",
      label: "Public HTTPS",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const { response, body } = await publicJson(`${base}/.well-known/oauth-protected-resource`);
    const resource = body && typeof body === "object" ? (body as Record<string, unknown>).resource : null;
    checks.push({
      id: "oauth",
      label: "OAuth discovery",
      ok: response.ok && resource === `${base}/mcp`,
      detail: response.ok ? "OAuth protected-resource metadata verified." : `OAuth metadata returned HTTP ${response.status}.`,
    });
  } catch (error) {
    checks.push({
      id: "oauth",
      label: "OAuth discovery",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const { response, body } = await publicJson(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "install-verify", method: "tools/list", params: {} }),
    });
    const tools = body && typeof body === "object"
      ? ((body as Record<string, unknown>).result as { tools?: Array<{ name?: string }> } | undefined)?.tools
      : undefined;
    const hasDeploymentList = Array.isArray(tools) && tools.some((tool) => tool.name === "deployment.list");
    checks.push({
      id: "mcp",
      label: "MCP discovery",
      ok: response.ok && hasDeploymentList,
      detail: response.ok && hasDeploymentList
        ? "Remote MCP tools are discoverable."
        : "MCP endpoint did not expose the expected deployment tool catalog.",
    });
  } catch (error) {
    checks.push({
      id: "mcp",
      label: "MCP discovery",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return checks;
}

export async function getInstanceAccessState(): Promise<InstanceAccessState> {
  const row = await prisma.appConfig.findUnique({ where: { key: ACCESS_CONFIG_KEY } });
  const state = parseState(row?.value);

  if (state.mode === "quick_tunnel") {
    const live = await quickTunnelUrl().catch(() => null);
    if (live && live !== state.publicUrl) {
      return saveState({ ...state, publicUrl: live, verifiedAt: null, checks: undefined });
    }
  }
  return state;
}

export async function publishTemporaryHttps(): Promise<InstanceAccessState> {
  await stopConnector(NAMED_CONTAINER).catch(() => undefined);
  await dockerRunCloudflared(QUICK_CONTAINER, [
    "tunnel",
    "--no-autoupdate",
    "--url",
    LOCAL_ORIGIN,
  ]);
  const publicUrl = await waitForQuickTunnelUrl();
  await waitForPublicOrigin(publicUrl);
  const checks = await verifyInstanceAccess(publicUrl);
  const verified = checks.every((check) => check.ok);

  return saveState({
    mode: "quick_tunnel",
    publicUrl,
    domain: new URL(publicUrl).hostname,
    temporary: true,
    verifiedAt: verified ? new Date().toISOString() : null,
    connector: QUICK_CONTAINER,
    checks,
  });
}

function zoneForDomain(zones: Array<Record<string, unknown>>, domain: string) {
  return zones
    .filter((zone) => {
      const name = String(zone.name || "").toLowerCase();
      return name && (domain === name || domain.endsWith(`.${name}`));
    })
    .sort((a, b) => String(b.name || "").length - String(a.name || "").length)[0] || null;
}

export async function publishCloudflareDomain(inputDomain: string): Promise<InstanceAccessState> {
  const domain = normalizeDomain(inputDomain);
  const account = await getActiveCloudflareAccount();
  if (!account) throw new Error("Connect a Cloudflare account before publishing a domain.");
  if (!account.accountId) throw new Error("The active Cloudflare connection needs an Account ID.");

  const zones = await listZones(account) as Array<Record<string, unknown>>;
  const zone = zoneForDomain(zones, domain);
  if (!zone?.id) {
    throw new Error(`No active Cloudflare zone owns ${domain}. Connect the account that manages this domain.`);
  }
  const zoneId = String(zone.id);

  const instanceId = await ensureGroundControlInstanceId();
  const tunnelName = `groundcontrol-${instanceId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 26)}`;

  let row = await prisma.cloudflareTunnel.findFirst({ where: { name: tunnelName } });
  let token = row?.tunnelSecret ? String(decryptMaybe(row.tunnelSecret) || "") : "";
  let tunnelId = row?.tunnelId || "";

  if (!row || !token || !tunnelId) {
    const created = await createTunnel(tunnelName, account);
    tunnelId = String(created.tunnel.id || "");
    token = String(created.token || "");
    if (!tunnelId || !token) throw new Error("Cloudflare did not return a tunnel credential.");

    row = await prisma.cloudflareTunnel.upsert({
      where: { tunnelId },
      create: {
        tunnelId,
        name: tunnelName,
        tunnelSecret: encryptIfNeeded(token),
        connectorId: NAMED_CONTAINER,
        status: "active",
        domains: domain,
        configJson: JSON.stringify(created.tunnel),
        cloudflareAccountId: account.id,
      },
      update: {
        tunnelSecret: encryptIfNeeded(token),
        connectorId: NAMED_CONTAINER,
        status: "active",
        domains: domain,
        cloudflareAccountId: account.id,
      },
    });
  }

  await updateTunnelConfiguration(
    tunnelId,
    [{ hostname: domain, service: LOCAL_ORIGIN }],
    account
  );

  const records = await listDnsRecords(zoneId, account) as Array<Record<string, unknown>>;
  const existing = records.find((record) => String(record.name || "").toLowerCase() === domain);
  const dns = {
    type: "CNAME",
    name: domain,
    content: `${tunnelId}.cfargotunnel.com`,
    ttl: 1,
    proxied: true,
    comment: "GroundControl control-plane tunnel",
  };
  if (existing?.id) {
    await updateDnsRecord(zoneId, String(existing.id), dns, account);
  } else {
    await createDnsRecord(zoneId, dns, account);
  }

  await stopConnector(QUICK_CONTAINER).catch(() => undefined);
  await dockerRunCloudflared(NAMED_CONTAINER, ["tunnel", "run", "--token", token]);

  await prisma.cloudflareTunnel.update({
    where: { id: row.id },
    data: {
      connectorId: NAMED_CONTAINER,
      status: "active",
      domains: domain,
      tunnelSecret: encryptIfNeeded(token),
    },
  });

  const publicUrl = `https://${domain}`;
  await waitForPublicOrigin(publicUrl);
  const checks = await verifyInstanceAccess(publicUrl);
  const verified = checks.every((check) => check.ok);

  return saveState({
    mode: "cloudflare_domain",
    publicUrl,
    domain,
    temporary: false,
    verifiedAt: verified ? new Date().toISOString() : null,
    tunnelId,
    connector: NAMED_CONTAINER,
    checks,
  });
}

export async function verifyPublishedInstance(): Promise<InstanceAccessState> {
  const current = await getInstanceAccessState();
  const checks = await verifyInstanceAccess(current.publicUrl);
  const verified = checks.every((check) => check.ok);
  return saveState({
    ...current,
    verifiedAt: verified ? new Date().toISOString() : null,
    checks,
  });
}

export async function keepInstancePrivate(): Promise<InstanceAccessState> {
  await Promise.all([
    stopConnector(QUICK_CONTAINER).catch(() => undefined),
    stopConnector(NAMED_CONTAINER).catch(() => undefined),
  ]);
  return saveState(PRIVATE_STATE);
}
