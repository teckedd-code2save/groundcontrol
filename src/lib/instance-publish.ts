import { createHash, randomUUID } from "node:crypto";
import { currentPublicIpv4, verifyCaddyDns, normalizePublicHostname } from "./caddy-address-preflight";
import { inspectGeneratedInstanceAddress, inspectCaddyPortNeeds } from "./generated-instance-address";
export { normalizePublicHostname } from "./caddy-address-preflight";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decryptMaybe, encryptIfNeeded } from "@/lib/crypto";
import {
  createDnsRecord,
  createTunnel,
  deleteTunnel,
  deleteDnsRecord,
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
import { execOnVps, shQuote } from "@/lib/vps";
import { HttpError } from "@/lib/errors";
import { isDesktopMode } from "@/lib/runtime";

const execFileAsync = promisify(execFile);

const CANONICAL_URL_KEY = "groundcontrol_canonical_url";
const BOOTSTRAP_FALLBACK_KEY = "groundcontrol_bootstrap_fallback_url";
const ALIASES_KEY = "groundcontrol_public_aliases";
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

async function setConfig(key: string, value: string, db: Pick<typeof prisma, "appConfig"> = prisma) {
  await db.appConfig.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function getConfig(key: string) {
  return (await prisma.appConfig.findUnique({ where: { key } }))?.value || "";
}

// Serializes the single web process used by the canonical installer. This is not
// a cross-process lease. Scoped host files refuse overwrite after uncertain work.
let publishing = false;
async function withPublishLock<T>(work: () => Promise<T>): Promise<T> {
  if (Number(process.env.WEB_CONCURRENCY || "1") > 1 || process.env.NODE_APP_INSTANCE !== undefined) {
    throw new HttpError("Access changes require the supported single-process GroundControl deployment. Multi-process publishing is unavailable; existing routes are unchanged.", 409);
  }
  if (publishing) throw new HttpError("Another access change is running. Wait for it to finish before retrying.", 409);
  publishing = true;
  try { return await work(); } finally { publishing = false; }
}

async function accessIdentity() {
  const [canonical, publicUrl, mode, rawAliases] = await Promise.all([
    getConfig(CANONICAL_URL_KEY), getConfig(PUBLIC_URL_KEY), getConfig(PUBLISH_MODE_KEY), getConfig(ALIASES_KEY),
  ]);
  const aliases: string[] = rawAliases ? JSON.parse(rawAliases) : [];
  // Migrate existing permanent installs without changing their issuer.
  const permanent = canonical || ((mode === "caddy" || mode === "cloudflare") ? publicUrl : "");
  return { canonical: permanent, aliases, mode, publicUrl };
}

async function savePublicAccess(url: string, mode: PublishMode, verification: InstanceVerification, db: Pick<typeof prisma, "appConfig"> = prisma) {
  const existing = await accessIdentity();
  const canonical = existing.canonical || url;
  const aliases = [...new Set([...existing.aliases, ...(url !== canonical ? [url] : [])])];
  if (!existing.canonical && existing.mode === "quick_tunnel" && existing.publicUrl) {
    await setConfig(BOOTSTRAP_FALLBACK_KEY, existing.publicUrl, db);
  }
  await setConfig(CANONICAL_URL_KEY, canonical, db);
  await setConfig(PUBLIC_URL_KEY, canonical, db);
  await setConfig(ALIASES_KEY, JSON.stringify(aliases), db);
  await setConfig(PUBLISH_MODE_KEY, existing.canonical ? existing.mode : mode, db);
  if (url === canonical) await setConfig(PUBLISH_EVIDENCE_KEY, JSON.stringify(verification), db);
  return { canonicalUrl: canonical, aliases, aliasUrl: url !== canonical ? url : null };
}

const identityKeys = [CANONICAL_URL_KEY, PUBLIC_URL_KEY, ALIASES_KEY, PUBLISH_MODE_KEY, PUBLISH_EVIDENCE_KEY, BOOTSTRAP_FALLBACK_KEY];
async function identitySnapshot() {
  return Promise.all(identityKeys.map(async key => [key, await getConfig(key)] as const));
}
async function verifySavedAccess(publicUrl: string, canonicalUrl: string, snapshot: Awaited<ReturnType<typeof identitySnapshot>>) {
  try {
    const aliasVerification = await verifyReplacementAccess(publicUrl);
    const verification = publicUrl === canonicalUrl ? aliasVerification : await verifyReplacementAccess(canonicalUrl);
    await setConfig(PUBLISH_EVIDENCE_KEY, JSON.stringify(verification));
    return { aliasVerification, verification };
  } catch {
    try {
      await prisma.$transaction(async tx => {
        for (const [key,value] of snapshot) await setConfig(key,value,tx);
      });
    } catch {
      throw new HttpError("New access did not pass final verification and restoring the previous identity failed. Both routes were retained; inspect instance address configuration before retrying.", 502);
    }
    throw new HttpError("New access did not pass final verification. Previous canonical identity and evidence were restored; existing access and the candidate route were retained for inspection. Retry only after reviewing the candidate.", 502);
  }
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

async function removeConnectorAndVerify(name: string) {
  const exactName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const result = await execOnHost([
    `docker rm -f ${shQuote(name)} >/dev/null 2>&1 || true`,
    `remaining=$(docker ps -a --filter ${shQuote(`name=^/${exactName}$`)} --format '{{.Names}}') || exit 1`,
    'test -z "$remaining"',
  ].join("\n"), { requireHost: true });
  if (result.code !== 0) throw new HttpError("Public access cleanup could not be verified. Inspect the connector before retrying.", 502);
}

async function stopQuickTunnel() {
  await removeConnectorAndVerify(QUICK_TUNNEL_CONTAINER);
}

async function disableCaddyExposure() {
  // Retry reload even if an earlier attempt removed the route file but failed to apply it.
  const result = await execOnHost(
    [
      "if [ -f /etc/caddy/sites/groundcontrol.caddy ] || [ -f /etc/caddy/groundcontrol.gc-retirement-pending ]; then",
      "  touch /etc/caddy/groundcontrol.gc-retirement-pending || exit 1",
      "  rm -f /etc/caddy/sites/groundcontrol.caddy || exit 1",
      "  command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ] || exit 1",
      "  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || exit 1",
      "  caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || systemctl reload caddy >/dev/null 2>&1 || rc-service caddy restart >/dev/null 2>&1 || exit 1",
      "  rm -f /etc/caddy/groundcontrol.gc-retirement-pending || exit 1",
      "fi",
    ].join("\n"),
    { requireHost: true }
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || "Could not remove the previous GroundControl Caddy route.");
  }
}

async function stopNamedManagementTunnel() {
  const row = await activeNamedTunnelRow();
  if (!row?.connectorId) return;
  await removeConnectorAndVerify(row.connectorId);
  await prisma.cloudflareTunnel.update({
    where: { id: row.id },
    data: { status: "inactive" },
  });
}

async function activeNamedTunnelRow(cloudflareAccountId?: number) {
  return prisma.cloudflareTunnel.findFirst({
    where: { name: NAMED_TUNNEL_NAME, ...(cloudflareAccountId === undefined ? {} : { cloudflareAccountId }) },
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
    return () => updateDnsRecord(zoneId, String(existing.id), {
      type: String(existing.type), name: String(existing.name), content: String(existing.content),
      ttl: Number(existing.ttl || 1), proxied: Boolean(existing.proxied), comment: String(existing.comment || ""),
    }, account);
  }
  const created = await createDnsRecord(zoneId, data, account);
  if (!created.id) throw new Error("Cloudflare DNS creation returned no record identity; inspect the candidate DNS record before retrying.");
  return () => deleteDnsRecord(zoneId, String(created.id), account);
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

type CloudflarePublishInput = {
  hostname: string;
  apiToken?: string;
  accountId?: string;
};
export async function publishWithCloudflare(input: CloudflarePublishInput) {
  return withPublishLock(() => publishCloudflareUnlocked(input));
}
async function publishCloudflareUnlocked(input: CloudflarePublishInput) {
  const priorIdentity = await accessIdentity();
  const snapshot = await identitySnapshot();
  const hostname = normalizePublicHostname(input.hostname);
  const requestedUrl = `https://${hostname}`;
  if (priorIdentity.canonical === requestedUrl || priorIdentity.aliases.includes(requestedUrl)) {
    const aliasVerification = await verifyReplacementAccess(requestedUrl);
    const verification = requestedUrl === priorIdentity.canonical ? aliasVerification : await verifyReplacementAccess(priorIdentity.canonical);
    await setConfig(PUBLISH_EVIDENCE_KEY, JSON.stringify(verification));
    return { mode: "cloudflare" as const, retainedBootstrapUrl: await getConfig(BOOTSTRAP_FALLBACK_KEY) || null,
      retainedConnectorCount: 0, publicUrl: requestedUrl, canonicalUrl: priorIdentity.canonical, aliases: priorIdentity.aliases,
      aliasUrl: requestedUrl === priorIdentity.canonical ? null : requestedUrl, hostname, tunnelId: null, zone: null, verification, aliasVerification };
  }
  // Keep the existing access path alive until the replacement is verified.
  let account = await getActiveCloudflareAccount();
  if ((!account || !account.accountId) && input.apiToken) {
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
  const previousRow = await activeNamedTunnelRow();
  let row = await activeNamedTunnelRow(account.id);
  let tunnelId = row?.tunnelId || "";
  let token = decryptMaybe(row?.tunnelSecret) || "";

  if (row && (!tunnelId || !token)) {
    throw new HttpError("The existing named tunnel record is incomplete. Recover its credentials and connector before adding a domain; no replacement was created.", 409);
  }
  if (!row) {
    const created = await createTunnel(NAMED_TUNNEL_NAME, account);
    tunnelId = String(created.tunnel.id || "");
    token = created.token;
    if (!tunnelId || !token) {
      throw new Error("Cloudflare did not return a usable tunnel.");
    }
  }

  const reusedTunnel = Boolean(row?.tunnelId === tunnelId && row?.tunnelSecret);
  const previousConnectorIds = [...new Set([previousRow?.connectorId, row?.connectorId].filter((id): id is string => Boolean(id)))];
  const priorHostnames = (row?.domains || "").split(",").map((value) => value.trim()).filter(Boolean);
  const reuseConnector = reusedTunnel;
  const connectorId = reuseConnector ? row?.connectorId || "" : `gc-control-plane-${randomUUID().slice(0, 18)}`;
  if (reuseConnector) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(connectorId)) throw new HttpError("The existing named tunnel has no usable recorded connector. Inspect and recover it before adding a domain; no replacement connector was created.", 409);
    const running = await execOnHost(`docker inspect --format '{{.State.Running}}' ${shQuote(connectorId)}`, { requireHost: true });
    if (running.code !== 0 || running.stdout.trim() !== "true") throw new HttpError("The existing named tunnel connector is not confirmed running. Recover the recorded connector before adding a domain; no replacement was created.", 409);
  }
  let committed = false;
  let restoreDns: (() => Promise<unknown>) | undefined;
  try {
    await updateTunnelConfiguration(
      tunnelId,
      [...new Set([...priorHostnames, hostname])].map((name) => ({ hostname: name, service: "http://groundcontrol-web:3000" })),
      account
    );
    restoreDns = await ensureTunnelDns(account, zone.id, hostname, tunnelId);

    if (!reuseConnector) await startNamedTunnelConnector(connectorId, token);

    const publicUrl = `https://${hostname}`;
    const verification = await verifyReplacementAccess(publicUrl, true);

    row = await prisma.$transaction(async (tx) => {
      const saved = await tx.cloudflareTunnel.upsert({
        where: { tunnelId },
        create: {
          tunnelId,
          name: NAMED_TUNNEL_NAME,
          tunnelSecret: encryptIfNeeded(token),
          connectorId,
          status: "active",
          domains: [...new Set([...priorHostnames, hostname])].join(","),
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
          domains: [...new Set([...priorHostnames, hostname])].join(","),
          configJson: JSON.stringify({
            purpose: "groundcontrol-management-plane",
            hostname,
            service: "http://groundcontrol-web:3000",
          }),
          cloudflareAccountId: account.id,
        },
      });

      await savePublicAccess(publicUrl, "cloudflare", verification, tx);
      return saved;
    });
    committed = true;
    // Recheck metadata after canonical identity is saved, before handing over the new address.
    const { aliasVerification, verification: canonicalVerification } = await verifySavedAccess(publicUrl, priorIdentity.canonical || publicUrl, snapshot);
    // This request may itself be using a previous connector. Keep all existing
    // connectors alive through delivery of the new URL; cleanup is a later,
    // explicit operation after the operator confirms the new access path.

    return {
      mode: "cloudflare" as const,
      retainedBootstrapUrl: await getConfig(BOOTSTRAP_FALLBACK_KEY) || null,
      retainedConnectorCount: previousConnectorIds.length,
      aliasVerification,
      canonicalUrl: (await accessIdentity()).canonical,
      aliases: (await accessIdentity()).aliases,
      aliasUrl: priorIdentity.canonical && priorIdentity.canonical !== publicUrl ? publicUrl : null,
      verification: canonicalVerification,
      publicUrl,
      tunnelId: row.tunnelId,
      hostname,
      zone: zone.name,
    };
  } catch (error) {
    if (!committed) {
      const cleanup = reuseConnector ? { code: 0 } : await execOnHost([
        `docker rm -f ${shQuote(connectorId)} >/dev/null 2>&1 || true`,
        // A successful listing proves absence; daemon/permission failure is uncertainty.
        `remaining=$(docker ps -a --filter ${shQuote(`name=^/${connectorId}$`)} --format '{{.Names}}') || exit 1`,
        'test -z "$remaining"',
      ].join("\n"), { requireHost: true });
      try {
        if (restoreDns) await restoreDns();
        if (reusedTunnel) await updateTunnelConfiguration(tunnelId, priorHostnames.map((name) => ({ hostname: name, service: "http://groundcontrol-web:3000" })), account);
        else await deleteTunnel(tunnelId, account);
      } catch {
        throw new HttpError("New public setup failed. Existing quick access was retained, but candidate tunnel cleanup needs inspection.", 502);
      }
      if (cleanup.code !== 0) throw new HttpError("New public setup failed. Existing quick access was retained, but candidate connector cleanup needs inspection.", 502);
    }
    if (committed && error instanceof HttpError && error.message.startsWith("New access")) throw error;
    if (committed) throw new HttpError("New public access was saved, but final verification did not complete. Existing permanent routes were retained. Inspect access before retrying.", 502);
    throw error;
  }
}

async function ensureCaddyInstalled() {
  const check = await execOnHost(
    "command -v caddy >/dev/null 2>&1 && caddy version || true",
    { requireHost: true }
  );
  if (check.stdout.trim()) return;

  const os = await execOnHost(
    '. /etc/os-release 2>/dev/null || true; printf \'%s\' "${ID:-unknown}"',
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

function caddyCandidatePath(hostname: string) {
  return `/etc/caddy/groundcontrol-sites/groundcontrol-${createHash("sha256").update(hostname).digest("hex").slice(0, 24)}.caddy`;
}

async function requireCaddyPorts() {
  const needs = await inspectCaddyPortNeeds();
  const blockers = needs.filter(need => need.blocking);
  if (blockers.length) throw new HttpError(blockers.map(need => need.detail).join(" "), 409);
}

async function configureCaddy(hostname: string, port: number) {
  await requireCaddyPorts();
  const path = caddyCandidatePath(hostname);
  const config = `${hostname} {\n  reverse_proxy 127.0.0.1:${port}\n  encode zstd gzip\n}\n`;
  // Never overwrite an existing route, including legacy groundcontrol.caddy.
  // A scoped file avoids restoring a stale snapshot of the entire Caddyfile.
  const prepared = await execOnHost([
    "set -eu", "test ! -L /etc/caddy/groundcontrol-sites", "mkdir -p -m 0755 /etc/caddy/groundcontrol-sites", `test ! -e ${shQuote(path)}`,
    "touch /etc/caddy/Caddyfile",
    "grep -Fq 'import /etc/caddy/groundcontrol-sites/*' /etc/caddy/Caddyfile || printf '\\nimport /etc/caddy/groundcontrol-sites/*\\n' >> /etc/caddy/Caddyfile",
    `(set -C; cat > ${shQuote(path)} <<'GC_CADDY'\n${config}GC_CADDY\n)`,
  ].join("\n"), { requireHost: true });
  if (prepared.code !== 0) throw new HttpError("Could not prepare a new scoped Caddy route. An existing route was not overwritten; inspect the candidate before retrying.", 409);
  const result = await execOnHost("caddy validate --config /etc/caddy/Caddyfile && (caddy reload --config /etc/caddy/Caddyfile || systemctl restart caddy || rc-service caddy restart || caddy start --config /etc/caddy/Caddyfile)", { requireHost: true });
  if (result.code !== 0) {
    await restoreCaddyBeforePublish(hostname);
    throw new Error(result.stderr || result.stdout || "Caddy configuration failed.");
  }
}

async function restoreCaddyBeforePublish(hostname: string) {
  const result = await execOnHost([
    "set -eu", `rm -f ${shQuote(caddyCandidatePath(hostname))}`,
    "caddy validate --config /etc/caddy/Caddyfile",
    "caddy reload --config /etc/caddy/Caddyfile || systemctl reload caddy || rc-service caddy restart",
  ].join("\n"), { requireHost: true });
  if (result.code !== 0) throw new HttpError("New public setup failed. Existing routes were retained; candidate Caddy cleanup needs inspection.", 502);
}

export async function publishServerAddress() {
  const plan = await inspectGeneratedInstanceAddress({ providerHostname: process.env.GC_PROVIDER_HOSTNAME });
  return publishWithCaddy({ hostname: plan.hostname, purpose: "server_address" });
}

export async function publishWithCaddy(input: { hostname: string; purpose?: "server_address" | "custom_domain" }) {
  return withPublishLock(() => publishCaddyUnlocked(input));
}
async function publishCaddyUnlocked(input: { hostname: string; purpose?: "server_address" | "custom_domain" }) {
  const priorIdentity = await accessIdentity();
  const snapshot = await identitySnapshot();
  const hostname = normalizePublicHostname(input.hostname);
  if (input.purpose === "server_address") {
    const plan = await inspectGeneratedInstanceAddress({ providerHostname: process.env.GC_PROVIDER_HOSTNAME });
    if (!plan.canPublish) throw new HttpError(plan.needs.filter(need => need.blocking).map(need => need.detail).join(" "), 409);
    if (hostname !== plan.hostname) throw new HttpError("The server address changed. Refresh the address plan and retry.", 409);
  }
  const requestedUrl = `https://${hostname}`;
  if (input.purpose === "server_address" && priorIdentity.canonical && priorIdentity.canonical !== requestedUrl) {
    throw new HttpError("This instance already has a permanent address. A changed server IP needs an explicit address migration; existing agent identity has not been replaced.", 409);
  }
  if (priorIdentity.canonical === requestedUrl || priorIdentity.aliases.includes(requestedUrl)) {
    const aliasVerification = await verifyReplacementAccess(requestedUrl);
    const verification = requestedUrl === priorIdentity.canonical ? aliasVerification : await verifyReplacementAccess(priorIdentity.canonical);
    await setConfig(PUBLISH_EVIDENCE_KEY, JSON.stringify(verification));
    return { mode: "caddy" as const, retainedBootstrapUrl: await getConfig(BOOTSTRAP_FALLBACK_KEY) || null, publicUrl: requestedUrl, canonicalUrl: priorIdentity.canonical, aliases: priorIdentity.aliases, aliasUrl: requestedUrl === priorIdentity.canonical ? null : requestedUrl, hostname, originIp: null, verification, aliasVerification };
  }
  // DNS/setup failures must not disconnect the operator from a quick tunnel.
  const originIp = await currentPublicIpv4();
  await verifyCaddyDns(hostname, originIp);

  // Inspect before package installation (which can start a service), then again
  // immediately before route changes to catch ownership changes during setup.
  await requireCaddyPorts();
  await ensureCaddyInstalled();
  const port = await groundControlHostPort();
  await configureCaddy(hostname, port);

  const publicUrl = `https://${hostname}`;
  let verification: InstanceVerification;
  try {
    verification = await verifyReplacementAccess(publicUrl, true);
    await prisma.$transaction(async (tx) => {
      await savePublicAccess(publicUrl, "caddy", verification, tx);
    });
  } catch (error) {
    await restoreCaddyBeforePublish(hostname);
    throw error;
  }
  let canonicalVerification: InstanceVerification;
  let aliasVerification: InstanceVerification;
  try {
    const verified = await verifySavedAccess(publicUrl, priorIdentity.canonical || publicUrl, snapshot);
    aliasVerification = verified.aliasVerification;
    canonicalVerification = verified.verification;
    // Do not close the bootstrap connector carrying this HTTP response.
  } catch (error) {
    if (error instanceof HttpError && error.message.startsWith("New access")) throw error;
    throw new HttpError("New public access was saved, but final verification did not complete. Existing permanent routes were retained. Inspect access before retrying.", 502);
  }

  return {
    mode: "caddy" as const,
    retainedBootstrapUrl: await getConfig(BOOTSTRAP_FALLBACK_KEY) || null,
    aliasVerification,
    canonicalUrl: (await accessIdentity()).canonical,
    aliases: (await accessIdentity()).aliases,
    aliasUrl: priorIdentity.canonical && priorIdentity.canonical !== publicUrl ? publicUrl : null,
    verification: canonicalVerification,
    publicUrl,
    hostname,
    originIp,
  };
}

export async function publishQuickTunnel() {
  return withPublishLock(publishQuickTunnelUnlocked);
}
async function publishQuickTunnelUnlocked() {
  if ((await accessIdentity()).canonical) throw new HttpError("A permanent address is already configured. Temporary setup cannot replace it. Keep using your current address.", 409);
  const network = await groundControlDockerNetwork();
  await stopQuickTunnel();
  await stopNamedManagementTunnel();
  await disableCaddyExposure();

  const command = [
    "docker run -d",
    `--name ${shQuote(QUICK_TUNNEL_CONTAINER)}`,
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
      `  if [ -n "$url" ]; then printf '%s' "$url"; exit 0; fi`,
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
  return withPublishLock(keepInstancePrivateUnlocked);
}
async function keepInstancePrivateUnlocked() {
  if ((await accessIdentity()).canonical) throw new HttpError("A permanent address is configured. Removing public access requires a separate explicit removal flow; it cannot be silently downgraded here.", 409);
  if (!isDesktopMode()) {
    await stopQuickTunnel();
    await stopNamedManagementTunnel();
    await disableCaddyExposure();
  }
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
      cache: "no-store",
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
  explicitPublicUrl?: string | null,
  options: { persist?: boolean } = {}
): Promise<InstanceVerification> {
  const publicUrl = String(explicitPublicUrl ?? await getConfig(PUBLIC_URL_KEY)).replace(/\/$/, "") || null;
  const configuredOrigin = await getConfig(CANONICAL_URL_KEY) || await getConfig(PUBLIC_URL_KEY);
  const oauthOrigin = configuredOrigin || "http://127.0.0.1:3000";
  const checkedAt = new Date().toISOString();
  const desktop = isDesktopMode();
  // The control plane's Docker socket is reachable from its app container.
  // Desktop checks must not enter the Docker Desktop VM's host namespaces.
  const inspectRuntime = (command: string) => desktop
    ? execOnVps(command, { id: 0, host: "127.0.0.1", port: 22, username: "root", isLocal: true })
    : execOnHost(command, { requireHost: true });

  const [containerResult, storageResult, hostResult, claim] = await Promise.all([
    inspectRuntime(
      `test "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' groundcontrol-web 2>/dev/null)" = healthy && echo ready || echo failed`
    ),
    inspectRuntime(
      `docker inspect groundcontrol-web --format '{{range .Mounts}}{{if eq .Destination "/app/prisma"}}{{.Type}}:{{.Name}}{{end}}{{end}}' 2>/dev/null`
    ),
    desktop ? Promise.resolve({ stdout: "", stderr: "", code: 0 }) : execOnHost("printf groundcontrol-host-ok", { requireHost: true }),
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
  let tools: Array<{ name?: string }> = [];
  if (mcp.body && typeof mcp.body === "object" && "result" in mcp.body) {
    const result = (mcp.body as {
      result?: { tools?: Array<{ name?: string }> };
    }).result;
    if (Array.isArray(result?.tools)) tools = result.tools;
  }
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
      let publicMcp = await httpCheck(`${publicUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "public-install-verification",
          method: "tools/list",
          params: {},
        }),
      });
      for (let attempt = 0; attempt < 7 && ((!publicProbe.ok && Boolean(configuredOrigin)) || !publicMcp.ok); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        if (!publicProbe.ok) {
          publicProbe = await httpCheck(`${publicUrl}/.well-known/oauth-protected-resource`);
        }
        if (!publicMcp.ok) {
          publicMcp = await httpCheck(`${publicUrl}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: "public-install-verification",
              method: "tools/list",
              params: {},
            }),
          });
        }
      }
      const [publicIdentity, publicAuthorization] = await Promise.all([
        httpCheck(`${publicUrl}/api/auth/claim`),
        httpCheck(`${publicUrl}/.well-known/oauth-authorization-server`),
      ]);
      const identity = publicIdentity.body as { instanceId?: string; claimed?: boolean } | null;
      const resource = publicProbe.body as { resource?: string; authorization_servers?: string[] } | null;
      const authorization = publicAuthorization.body as { issuer?: string; authorization_endpoint?: string; token_endpoint?: string } | null;
      const sameInstance = publicIdentity.ok && Boolean(claim.instanceId) && identity?.instanceId === claim.instanceId && identity?.claimed === true;
      // Alias reachability and identity are independent of the canonical OAuth issuer.
      // Pre-commit candidates must advertise the currently saved issuer, not a header-derived origin.
      const correctOAuth = publicProbe.ok && resource?.resource === `${oauthOrigin}/mcp` &&
        Array.isArray(resource.authorization_servers) && resource.authorization_servers.includes(oauthOrigin) &&
        publicAuthorization.ok && authorization?.issuer === oauthOrigin &&
        authorization.authorization_endpoint === `${oauthOrigin}/oauth/authorize` && authorization.token_endpoint === `${oauthOrigin}/oauth/token`;
      const publicTools = publicMcp.body && typeof publicMcp.body === "object" && "result" in publicMcp.body
        ? ((publicMcp.body as { result?: { tools?: Array<{ name?: string }> } }).result?.tools || [])
        : [];
      const publicMcpReady = publicMcp.ok && publicTools.some((tool) => tool.name === "deployment.list");
      publicHttps = check(
        correctOAuth && sameInstance && publicMcpReady,
        `HTTPS, matching instance identity, OAuth metadata and MCP discovery are reachable at ${publicUrl}.`,
        `Public verification failed at ${publicUrl} (instance identity ${sameInstance ? "matched" : "not matched"}, OAuth ${correctOAuth ? "valid" : "invalid"}, MCP HTTP ${publicMcp.status || "unreachable"}).`
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
      hostExecution: desktop ? {
        status: "skipped",
        detail: "Local Docker workspace: native computer services are outside this installation. Add a Linux server for host management.",
      } : check(
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

  if (options.persist !== false) await setConfig(PUBLISH_EVIDENCE_KEY, JSON.stringify(result));
  return result;
}

async function verifyReplacementAccess(publicUrl: string, initialBootstrap = false) {
  // Probe the candidate explicitly without changing the saved OAuth/public base.
  const verification = await verifyGroundControlInstance(publicUrl, { persist: false });
  if (verification.checks.publicHttps.status !== "ready") {
    // An existing private installation has no public issuer yet. Authenticate the
    // candidate by TLS + claimed instance identity before saving its first origin.
    // OAuth remains failed in this evidence until the mandatory post-save recheck.
    if (initialBootstrap && !await getConfig(CANONICAL_URL_KEY) && !await getConfig(PUBLIC_URL_KEY)) {
      const [identity, claim] = await Promise.all([httpCheck(`${publicUrl}/api/auth/claim`), installClaimStatus()]);
      const body = identity.body as { instanceId?: string; claimed?: boolean } | null;
      if (publicUrl.startsWith("https://") && identity.ok && claim.claimed && claim.instanceId && body?.instanceId === claim.instanceId && body.claimed === true) return verification;
    }
    const failed = verification.checks.publicHttps.detail;
    throw new HttpError(`New public access was not verified. Existing access has not been retired. ${failed}`, 502);
  }
  return verification;
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
    retainedBootstrapUrl: await getConfig(BOOTSTRAP_FALLBACK_KEY) || null,
    canonicalUrl: (await accessIdentity()).canonical || null,
    aliases: (await accessIdentity()).aliases,
    localDesktop: isDesktopMode(),
    mode: (mode || "private") as PublishMode,
    publicUrl: publicUrl || null,
    claimed: claim.claimed,
    cloudflareConfigured: Boolean(activeCloudflare?.accountId),
    cloudflareAccountId: activeCloudflare?.accountId || null,
    lastVerification,
  };
}
