import { listZones } from "@/lib/cloudflare";
import { provisionCustomDomain } from "@/lib/deploy/cloudflare-links";
import { getVpsPublicIp } from "@/lib/k8s/utils";
import {
  execOnVps,
  getActiveVps,
  getSystemConfig,
  shQuote,
  type VpsConnection,
} from "@/lib/vps";

export interface DomainSwitchInput {
  domain: string;
  zoneId?: string;
  upstream: string;
  vps?: VpsConnection | null;
  removeOldSitePath?: string | null;
}

export interface DomainSwitchResult {
  domain: string;
  zoneId: string;
  recordId: string;
  recordName: string;
  sitePath: string;
  publicUrl: string;
}

export function parseDomainInput(value: unknown): { domain: string | null; error?: string } {
  const text = String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
  if (!text) return { domain: null, error: "Enter a domain." };
  const hostname =
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(text);
  if (!hostname) return { domain: null, error: "Enter a valid hostname." };
  return { domain: text };
}

export function renderCaddySiteBlock(domain: string, upstream: string): string {
  return [
    `http://${domain} {`,
    `\tredir https://${domain}{uri}`,
    `}`,
    ``,
    `${domain} {`,
    `\treverse_proxy ${upstream}`,
    `}`,
    ``,
  ].join("\n");
}

export async function resolveZoneIdForDomain(
  domain: string,
  zoneId?: string | null
): Promise<string> {
  if (zoneId) return zoneId;
  const zones = await listZones();
  const match = zones
    .filter((zone): zone is Record<string, unknown> & { id: string; name: string } => {
      return typeof zone.id === "string" && typeof zone.name === "string";
    })
    .filter((zone) => domain === zone.name || domain.endsWith(`.${zone.name}`))
    .sort((a, b) => (b.name.length - a.name.length));
  if (!match[0]) {
    throw new Error("No Cloudflare zone matches this domain. Add the zone to GroundControl or pass a zoneId.");
  }
  return match[0].id;
}

async function writeCaddyReverseProxySite(
  domain: string,
  upstream: string,
  vps: VpsConnection | null
): Promise<string> {
  const config = await getSystemConfig();
  const sitePath = `${config.caddySitesDir}/50-${domain}.caddy`;
  const content = renderCaddySiteBlock(domain, upstream);
  const write = await execOnVps(
    `mkdir -p ${shQuote(config.caddySitesDir)} && cat > ${shQuote(sitePath)} <<'EOF'\n${content}\nEOF`,
    vps
  );
  if (write.code !== 0) {
    throw new Error(`Failed to write Caddy site: ${write.stderr || write.stdout}`);
  }
  await execOnVps(
    `caddy reload --config ${shQuote(config.caddyFile)} 2>/dev/null || systemctl reload caddy 2>/dev/null || caddy reload 2>/dev/null || true`,
    vps
  );
  return sitePath;
}

async function removeCaddySiteFile(sitePath: string, vps: VpsConnection | null): Promise<void> {
  if (!sitePath) return;
  await execOnVps(`rm -f ${shQuote(sitePath)}`, vps);
  await execOnVps(
    `caddy reload 2>/dev/null || systemctl reload caddy 2>/dev/null || true`,
    vps
  );
}

export async function switchDeploymentDomain(
  input: DomainSwitchInput
): Promise<DomainSwitchResult> {
  const parsed = parseDomainInput(input.domain);
  if (!parsed.domain) throw new Error(parsed.error || "Invalid domain");
  if (!input.upstream.trim()) throw new Error("An upstream (host:port) is required to route the new domain.");

  const vps = input.vps ?? (await getActiveVps().catch(() => null));
  const zoneId = await resolveZoneIdForDomain(parsed.domain, input.zoneId);
  const ip = await getVpsPublicIp(vps);
  if (!ip) throw new Error("Could not determine the VPS public IP for the DNS record.");

  const record = await provisionCustomDomain({
    subdomain: parsed.domain,
    zoneId,
    targetHost: ip,
    proxied: true,
    recordType: "A",
  });

  const sitePath = await writeCaddyReverseProxySite(parsed.domain, input.upstream.trim(), vps);

  if (input.removeOldSitePath) {
    await removeCaddySiteFile(input.removeOldSitePath, vps);
  }

  return {
    domain: parsed.domain,
    zoneId,
    recordId: record.recordId,
    recordName: record.name,
    sitePath,
    publicUrl: `https://${parsed.domain}`,
  };
}
