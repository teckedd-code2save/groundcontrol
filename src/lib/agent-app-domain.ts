import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { normalizePublicHostname } from "./instance-publish";

export interface AppDomainHostSnapshot {
  id: number;
  host: string;
  port: number;
  username: string;
  authType: string;
  isLocal: boolean;
  updatedAt: string;
}
/** Observations must come from trusted read-only checks, not agent assertions. */
export interface AppDomainPreflight {
  caddyInstalled: boolean | null;
  caddyConfigValid: boolean | null;
  managedSitesImported: boolean | null;
  managedDirectoryWritable: boolean | null;
  hostnameAvailable: boolean | null;
  ownershipVerified: boolean | null;
  port80Reachable: boolean | null;
  port443Reachable: boolean | null;
  dnsA: string[] | null;
  dnsAAAA: string[] | null;
}
export interface AppDomainPlanInput {
  deploymentId: number;
  host: AppDomainHostSnapshot;
  hostname: string;
  approvedLoopbackPort: number;
  observedPublicIpv4: string;
  hostnameApproved: boolean;
  /** Include GC's canonical hostname and production application hostnames. */
  protectedHostnames: string[];
  preflight: AppDomainPreflight;
}
export interface AppDomainBlocker { field: string; message: string }
const safeText = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x20\x7f]/.test(value);
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
function hostname(value: unknown): string {
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Use a public hostname without control characters.");
  return normalizePublicHostname(value);
}
function publicIpv4(value: unknown): value is string {
  if (typeof value !== "string" || isIP(value) !== 4) return false;
  const [a,b,c] = value.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && [0,2].includes(c)))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
function hostSnapshot(value: AppDomainHostSnapshot): AppDomainHostSnapshot {
  if (!value || !integer(value.id,1,Number.MAX_SAFE_INTEGER) || !safeText(value.host,253) || !integer(value.port,1,65535) || !safeText(value.username,128) || !["key","password"].includes(value.authType) || typeof value.isLocal !== "boolean" || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("An exact existing host snapshot is required.");
  return { id:value.id, host:value.host, port:value.port, username:value.username, authType:value.authType, isLocal:value.isLocal, updatedAt:new Date(value.updatedAt).toISOString() };
}

/** Pure plan only: never installs Caddy, writes DNS/files, opens ports or changes GC identity. */
export function planAgentAppDomain(input: AppDomainPlanInput) {
  if (!input || !integer(input.deploymentId,1,Number.MAX_SAFE_INTEGER) || !integer(input.approvedLoopbackPort,1024,65535)) throw new Error("Choose a deployment and an approved unprivileged loopback port.");
  const host = hostSnapshot(input.host);
  const domain = hostname(input.hostname);
  if (!publicIpv4(input.observedPublicIpv4)) throw new Error("Supply the observed public IPv4 of this approved host, not a private or reserved address.");
  if (typeof input.hostnameApproved !== "boolean" || !Array.isArray(input.protectedHostnames) || !input.preflight) throw new Error("Explicit hostname approval, protected hostnames and preflight observations are required.");
  const protectedNames = input.protectedHostnames.map(hostname);
  const blockers: AppDomainBlocker[] = [];
  const block = (field: string, message: string) => blockers.push({ field, message });
  if (!input.hostnameApproved) block("hostnameApproved", "Ask the owner to approve this exact application hostname before publishing.");
  if (protectedNames.includes(domain)) block("hostname", "This hostname is protected for GroundControl or an existing production application. Choose a separate application hostname.");
  const checks: Array<[keyof AppDomainPreflight,string]> = [
    ["caddyInstalled", "Install Caddy through the approved server tooling flow; this plan does not install software."],
    ["caddyConfigValid", "Validate the existing Caddy configuration before adding an application route."],
    ["managedSitesImported", "Confirm the Caddyfile imports /etc/caddy/sites/*. Configure that prerequisite separately without replacing existing routes."],
    ["managedDirectoryWritable", "Prepare the managed Caddy directory through owner-approved setup; this plan does not change permissions."],
    ["hostnameAvailable", "Check all existing routes for hostname ownership. Do not overwrite a production or other deployment route."],
    ["ownershipVerified", "Verify domain control through the configured DNS provider or an owner-completed DNS challenge. A hostname entered by an agent is not proof."],
    ["port80Reachable", "Verify inbound TCP 80 reaches this server from outside. Any Azure NSG or host-firewall change needs separate explicit approval."],
    ["port443Reachable", "Verify inbound TCP 443 reaches this server from outside. Any Azure NSG or host-firewall change needs separate explicit approval."],
  ];
  for (const [key,message] of checks) {
    const value = input.preflight[key];
    if (value !== true && value !== false && value !== null) throw new Error(`Invalid preflight observation: ${key}`);
    if (value !== true) block(key,message);
  }
  const a = input.preflight.dnsA, aaaa = input.preflight.dnsAAAA;
  if (a !== null && (!Array.isArray(a) || a.some(ip => typeof ip !== "string" || isIP(ip) !== 4))) throw new Error("Invalid A-record observations.");
  if (aaaa !== null && (!Array.isArray(aaaa) || aaaa.some(ip => typeof ip !== "string" || isIP(ip) !== 6))) throw new Error("Invalid AAAA-record observations.");
  if (!a?.length || a.some(ip => ip !== input.observedPublicIpv4)) block("dnsA", `Create or correct the direct A record for ${domain} to ${input.observedPublicIpv4}. No DNS record is changed by this plan.`);
  if (aaaa === null || aaaa.length) block("dnsAAAA", "Check AAAA records. This IPv4-only plan cannot verify IPv6 routing; resolve stale IPv6 records or use a separately reviewed dual-stack plan.");
  const sitePath = `/etc/caddy/sites/gc-app-${input.deploymentId}.caddy`;
  const upstream = `127.0.0.1:${input.approvedLoopbackPort}`;
  const config = `${domain} {\n  reverse_proxy ${upstream}\n}\n`;
  const identity = { version:1, deploymentId:input.deploymentId, host, hostname:domain, approvedLoopbackPort:input.approvedLoopbackPort, observedPublicIpv4:input.observedPublicIpv4, sitePath, config };
  return {
    ...identity, upstream, publicUrl:`https://${domain}`,
    planHash:createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
    requiredDns:{ type:"A" as const, name:domain, content:input.observedPublicIpv4, mode:"direct" as const },
    readyForPublishReview:blockers.length === 0, blockers,
    preservesGroundControlIdentity:true as const,
    notice:"Plan only. No DNS, firewall, proxy, application, production route or GroundControl identity was changed. Passing preflight is not authorization to publish.",
  };
}

/** Contract for a future durable publisher, deliberately not executable shell commands. */
export const APP_DOMAIN_PUBLISH_REQUIREMENTS = [
  "Require fresh owner/admin approval bound to the plan hash, exact deployment, host snapshot and hostname; recheck authorization and observations at dispatch.",
  "Verify this deployment owns the running loopback service before exposing it. Never accept arbitrary upstreams, Caddy directives or management-instance publishing calls.",
  "Take a host-wide Caddy configuration lock; reserve a deployment-specific route and per-operation backup. Refuse symlinks, route collisions and unexpected existing content.",
  "Stage the minimal site, validate the complete Caddy configuration, atomically install it, then reload and propagate failures. Do not stop other proxies or automatically install dependencies.",
  "Verify external trusted HTTPS with hostname/SNI and a deployment-specific response marker, plus real application health. Never disable TLS verification or equate DNS with reachability.",
  "Save the app public URL only after verification. Preserve all production routes, the previous app route, GC issuer and management tunnels. On failure restore only this operation's changes and record uncertain outcomes for inspection, not automatic replay.",
  "DNS writes and inbound NSG/firewall changes require separate concrete approval; do not hide them inside first launch or proxy publication.",
] as const;
