/**
 * Cloudflare link helpers for the deploy pipeline.
 *
 * - provisionCustomDomain: idempotent DNS record create/update.
 * - createQuickTunnel / destroyQuickTunnel: ephemeral trycloudflare.com tunnels.
 */

import {
  listDnsRecords,
  createDnsRecord,
  updateDnsRecord,
  getZone,
  type DnsRecordData,
} from "@/lib/cloudflare";
import {
  execOnVps,
  shQuote,
  getActiveVps,
  type VpsConnection,
} from "@/lib/vps";
import { getVpsPublicIp, execKubectl } from "@/lib/k8s/utils";

export interface CustomDomainResult {
  recordId: string;
  name: string;
  content: string;
}

export interface QuickTunnelProcessInfo {
  pid: number;
  port: number;
  logPath: string;
  vps: VpsConnection;
}

export interface QuickTunnelResult {
  url: string;
  processInfo: QuickTunnelProcessInfo;
}

export interface QuickTunnelListItem {
  pid: number;
  port: number;
  command: string;
  url?: string;
}

const QUICK_TUNNEL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com\b/;
const QUICK_TUNNEL_LOG_DIR = "/tmp";

/**
 * Ensure a subdomain is a fully-qualified DNS record name.
 * If the user types "api" and the zone is "example.com", returns "api.example.com".
 * If the user already typed "api.example.com", returns it unchanged.
 */
export async function resolveRecordName(
  subdomain: string,
  zoneId: string
): Promise<string> {
  if (!subdomain) return "";
  if (subdomain.includes(".")) return subdomain;

  try {
    const zone = await getZone(zoneId);
    const zoneName = typeof zone?.name === "string" ? zone.name : "";
    if (zoneName) {
      return `${subdomain}.${zoneName}`;
    }
  } catch {
    // fall through to returning the bare subdomain; the API call will fail
    // with a clearer error if the name is invalid.
  }

  return subdomain;
}

/** Extract the first trycloudflare.com quick-tunnel URL from a string. */
export function extractQuickTunnelUrl(stdout: string): string | undefined {
  const match = stdout.match(QUICK_TUNNEL_REGEX);
  return match?.[0];
}

/** Redact common credential-like patterns from a string. */
export function redactSecrets(input: string): string {
  let output = input;

  // PEM private keys (-----BEGIN ... -----END ...-----)
  output = output.replace(
    /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/gi,
    "[REDACTED]"
  );

  // JSON/object values for sensitive keys.
  const sensitiveKeys = ["private_key", "token", "password", "secret", "credential"];
  const keyPattern = sensitiveKeys.join("|");
  output = output.replace(
    new RegExp(`"(${keyPattern})":\\s*"[^"]*"`, "gi"),
    `"$1": "[REDACTED]"`
  );
  output = output.replace(
    new RegExp(`(${keyPattern})=([^\\s&]+)`, "gi"),
    `$1=[REDACTED]`
  );

  return output;
}

/**
 * Create or update a DNS record in a Cloudflare zone so a custom domain points
 * at the deployment target.
 *
 * If `recordId` is provided the existing record is updated directly, making the
 * call idempotent for a target that already tracks its DNS record.
 */
export async function provisionCustomDomain({
  subdomain,
  zoneId,
  targetHost,
  proxied = true,
  recordType = "CNAME",
  recordId: existingRecordId,
}: {
  subdomain: string;
  zoneId: string;
  targetHost: string;
  proxied?: boolean;
  recordType?: "A" | "CNAME" | string;
  recordId?: string;
}): Promise<CustomDomainResult> {
  if (!subdomain || !zoneId || !targetHost) {
    throw new Error("subdomain, zoneId and targetHost are required");
  }

  const recordName = await resolveRecordName(subdomain, zoneId);

  console.log(`[cloudflare-links] provisioning ${recordType} ${recordName} -> ${targetHost}`);

  const data: DnsRecordData = {
    type: recordType,
    name: recordName,
    content: targetHost,
    proxied,
    ttl: 1, // auto
  };

  let result: Record<string, unknown>;
  if (existingRecordId) {
    console.log(`[cloudflare-links] updating existing DNS record ${existingRecordId}`);
    result = await updateDnsRecord(zoneId, existingRecordId, data);
  } else {
    const records = await listDnsRecords(zoneId);
    const existing = records.find(
      (r) =>
        typeof r.name === "string" &&
        r.name.toLowerCase() === recordName.toLowerCase()
    );

    if (existing && typeof existing.id === "string") {
      console.log(`[cloudflare-links] updating existing DNS record ${existing.id}`);
      result = await updateDnsRecord(zoneId, existing.id, data);
    } else {
      console.log(`[cloudflare-links] creating new DNS record`);
      result = await createDnsRecord(zoneId, data);
    }
  }

  const recordId = typeof result.id === "string" ? result.id : "";
  const name = typeof result.name === "string" ? result.name : recordName;
  const content = typeof result.content === "string" ? result.content : targetHost;

  return { recordId, name, content };
}

/**
 * Provision a DNS record for a k3s ingress.
 *
 * - With a `tunnelId`, creates a CNAME to `<tunnelId>.cfargotunnel.com` so the
 *   hostname routes through an existing Cloudflare Tunnel.
 * - Otherwise creates an A record pointing at the VPS public IP.
 */
export async function provisionK3sIngress({
  subdomain,
  zoneId,
  vps,
  tunnelId,
}: {
  subdomain: string;
  zoneId: string;
  vps?: VpsConnection | null;
  tunnelId?: string;
}): Promise<CustomDomainResult> {
  if (!subdomain || !zoneId) {
    throw new Error("subdomain and zoneId are required");
  }

  let targetHost: string;
  let recordType: "A" | "CNAME" = "A";

  if (tunnelId) {
    targetHost = `${tunnelId}.cfargotunnel.com`;
    recordType = "CNAME";
  } else {
    targetHost = await getVpsPublicIp(vps);
    if (!targetHost) {
      throw new Error(
        "Could not determine VPS public IP; set tunnelId to use a Cloudflare Tunnel instead"
      );
    }
  }

  console.log(
    `[cloudflare-links] provisioning k3s ingress ${recordType} ${subdomain} -> ${targetHost}`
  );

  return provisionCustomDomain({
    subdomain,
    zoneId,
    targetHost,
    recordType,
    proxied: true,
  });
}

/**
 * Best-effort helper: annotate an existing k3s ingress so operators can tell it
 * is fronted by a Cloudflare Tunnel. The annotation is informational only;
 * Cloudflare Tunnel routing is configured in the Cloudflare dashboard or via
 * cloudflared config, not through Kubernetes ingress resources.
 */
export async function annotateK3sIngressForTunnel(
  namespace: string,
  ingressName: string,
  tunnelId: string,
  vps?: VpsConnection | null
): Promise<void> {
  if (!namespace || !ingressName || !tunnelId) return;
  const annotation = `cloudflare.com/tunnel-id=${shQuote(tunnelId)}`;
  await execKubectl(
    `annotate ingress ${shQuote(ingressName)} -n ${shQuote(namespace)} ${annotation} --overwrite`,
    vps
  );
}

/**
 * Start a cloudflared quick tunnel (`cloudflared tunnel --url`) on the active
 * VPS and return the public trycloudflare.com URL plus process metadata.
 */
export async function createQuickTunnel(
  port: number,
  vps?: VpsConnection | null
): Promise<QuickTunnelResult> {
  const conn = vps || (await getActiveVps());
  if (!conn) {
    throw new Error("No VPS configured; cannot create quick tunnel");
  }

  const binaryCheck = await execOnVps(
    `command -v cloudflared 2>/dev/null || echo ""`,
    conn
  );
  const binary = binaryCheck.stdout.trim();
  if (!binary) {
    throw new Error(
      "cloudflared binary not found on the target VPS; install cloudflared first"
    );
  }

  const logPath = `${QUICK_TUNNEL_LOG_DIR}/cloudflared-quick-${port}-${Date.now()}.log`;
  const targetUrl = `http://localhost:${port}`;

  const command =
    `nohup ${shQuote(binary)} tunnel --url ${shQuote(targetUrl)} ` +
    `> ${shQuote(logPath)} 2>&1 </dev/null & echo $!`;

  console.log(`[cloudflare-links] starting quick tunnel to ${targetUrl}`);

  const startResult = await execOnVps(command, conn);
  if (startResult.code !== 0) {
    throw new Error(
      `Failed to start cloudflared quick tunnel: ${startResult.stderr || startResult.stdout}`
    );
  }

  const pid = parseInt(startResult.stdout.trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(
      `Could not parse quick tunnel PID from output: ${startResult.stdout}`
    );
  }

  const url = await waitForQuickTunnelUrl(logPath, conn, 30_000);
  if (!url) {
    // Best-effort cleanup so we don't leave a zombie tunnel behind.
    await execOnVps(`kill ${pid} 2>/dev/null || true`, conn).catch(() => {});
    throw new Error(
      `Timed out waiting for trycloudflare.com URL in ${logPath}`
    );
  }

  console.log(`[cloudflare-links] quick tunnel ready: ${url}`);

  return {
    url,
    processInfo: {
      pid,
      port,
      logPath,
      vps: conn,
    },
  };
}

/**
 * Stop a quick tunnel started by {@link createQuickTunnel}.
 */
export async function destroyQuickTunnel(
  processInfo: QuickTunnelProcessInfo
): Promise<void> {
  const { pid, vps, logPath } = processInfo;
  if (!pid || !vps) {
    throw new Error("Invalid quick tunnel process info");
  }

  console.log(`[cloudflare-links] stopping quick tunnel PID ${pid}`);

  const result = await execOnVps(
    `kill ${pid} 2>/dev/null || kill -9 ${pid} 2>/dev/null || true`,
    vps
  );

  // Clean up the log file; don't fail the destroy if this races.
  await execOnVps(`rm -f ${shQuote(logPath)}`, vps).catch(() => {});

  if (result.code !== 0) {
    console.warn(
      `[cloudflare-links] non-zero exit while stopping tunnel: ${result.stderr}`
    );
  }
}

/**
 * Parse a JSON quick-tunnel process info string (e.g. stored on a Deployment)
 * and stop the tunnel. No-op if the input is empty or cannot be parsed.
 */
export async function destroyQuickTunnelByInfo(
  processInfo: string | null | undefined
): Promise<void> {
  if (!processInfo) return;

  let parsed: Partial<QuickTunnelProcessInfo> & { vps?: VpsConnection | null };
  try {
    parsed = JSON.parse(processInfo) as typeof parsed;
  } catch {
    console.warn("[cloudflare-links] could not parse quick tunnel process info");
    return;
  }

  if (!parsed.pid || !parsed.vps) return;

  await destroyQuickTunnel({
    pid: parsed.pid,
    port: parsed.port ?? 0,
    logPath: parsed.logPath ?? "",
    vps: parsed.vps,
  }).catch((err) => {
    console.warn(
      `[cloudflare-links] failed to destroy quick tunnel by info: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  });
}

/**
 * List running cloudflared quick tunnels on the active VPS.
 * This is a best-effort helper; URLs are only available when the corresponding
 * log file path can be inferred and still exists.
 */
export async function listQuickTunnels(
  vps?: VpsConnection | null
): Promise<QuickTunnelListItem[]> {
  const conn = vps || (await getActiveVps());
  if (!conn) return [];

  const psResult = await execOnVps(
    `ps -eo pid,args | awk '/cloudflared tunnel --url/ && !/awk/'`,
    conn
  );

  if (psResult.code !== 0 || !psResult.stdout.trim()) {
    return [];
  }

  const items: QuickTunnelListItem[] = [];
  for (const line of psResult.stdout.trim().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = parseInt(match[1], 10);
    const command = match[2];
    const portMatch = command.match(/--url\s+https?:\/\/localhost:(\d+)/);
    const port = portMatch ? parseInt(portMatch[1], 10) : 0;

    let url: string | undefined;
    if (Number.isFinite(pid)) {
      url = await readQuickTunnelUrlFromRunningProcess(pid, conn);
    }

    items.push({ pid, port, command, url });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForQuickTunnelUrl(
  logPath: string,
  vps: VpsConnection,
  timeoutMs: number
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await execOnVps(`cat ${shQuote(logPath)} 2>/dev/null || true`, vps);
    if (result.code === 0 && result.stdout) {
      const url = extractQuickTunnelUrl(result.stdout);
      if (url) {
        return url;
      }
    }
    await sleep(500);
  }

  return null;
}

async function readQuickTunnelUrlFromRunningProcess(
  pid: number,
  vps: VpsConnection
): Promise<string | undefined> {
  // Try the common log naming pattern we use. There may be multiple; pick the
  // first one that contains a URL for this PID.
  const logsResult = await execOnVps(
    `ls -1 ${shQuote(QUICK_TUNNEL_LOG_DIR)}/cloudflared-quick-*.log 2>/dev/null || true`,
    vps
  );

  if (logsResult.code !== 0 || !logsResult.stdout.trim()) {
    return undefined;
  }

  for (const logPath of logsResult.stdout.trim().split("\n")) {
    const content = await execOnVps(`cat ${shQuote(logPath)} 2>/dev/null || true`, vps);
    if (content.code !== 0 || !content.stdout) continue;

    // Heuristic: the log belongs to this PID if it mentions the same PID.
    if (!content.stdout.includes(String(pid))) continue;

    const url = extractQuickTunnelUrl(content.stdout);
    if (url) return url;
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
