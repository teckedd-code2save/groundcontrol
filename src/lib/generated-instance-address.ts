import { inspectAddressFirewallAssistance, type AddressFirewallAssistance } from "./address-firewall-assistance";
import { isIP } from "node:net";
import { currentPublicIpv4, normalizePublicHostname, verifyCaddyDns, execReadOnlyAddressProbe } from "./caddy-address-preflight";
import { HttpError } from "./errors";

export type GeneratedAddressNeed = {
  code: "ports_unverified" | "proxy_conflict" | "port_inspection_unavailable" | "caddy_setup" | "host_firewall_review" | "provider_firewall_review";
  blocking: boolean;
  detail: string;
};
export type GeneratedAddressPlan = {
  hostname: string;
  publicUrl: string;
  source: "provider" | "sslip";
  publicIpv4: string;
  stability: string;
  needs: GeneratedAddressNeed[];
  canPublish: boolean;
  firewallAssistance?: AddressFirewallAssistance;
};

/** Only globally routable unicast IPv4 is eligible for the public-IP-derived default. */
export function isPublicIpv4(value: string) {
  if (isIP(value) !== 4) return false;
  const [a, b, c] = value.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

/** Read-only port ownership gate shared by generated and custom direct HTTPS. */
export async function inspectCaddyPortNeeds(): Promise<GeneratedAddressNeed[]> {
  const needs: GeneratedAddressNeed[] = [];
  try {
    const result = await execReadOnlyAddressProbe(
      "command -v ss >/dev/null 2>&1 || exit 127; ss -H -ltnp",
      10_000,
    );
    if (result.code !== 0) throw new Error("Port inspection unavailable");
    const lines = result.stdout.split("\n").filter(line => line.trim());
    if (lines.some(line => !/^LISTEN\s+\d+\s+\d+\s+\S+\s+\S+/.test(line.trim()))) {
      throw new Error("Unrecognized port inspection output");
    }
    const relevant = lines.filter(line => {
      // ss -H -ltnp: State Recv-Q Send-Q Local-Address:Port Peer-Address:Port Process
      const local = line.trim().split(/\s+/)[3];
      return local && /:(80|443)$/.test(local);
    });
    // Unknown process ownership must not be treated as a free/Caddy-owned port.
    if (relevant.some(line => {
      const owners = [...line.matchAll(/\("([^"]+)",pid=/g)].map(match => match[1]);
      return !owners.length || owners.some(owner => owner !== "caddy");
    })) {
      needs.push({ code: "proxy_conflict", blocking: true, detail: "Ports 80 or 443 are in use by another or unidentified service. Configure that existing reverse proxy for this hostname, or deliberately free the ports before retrying. GroundControl will not replace it." });
    }
  } catch {
    needs.push({ code: "port_inspection_unavailable", blocking: true, detail: "Could not inspect ports 80 and 443. Check host access and that the ss command is available, then retry. No proxy or firewall has been changed." });
  }
  return needs;
}

/**
 * Read-only plan. A supplied provider hostname must come from explicit instance
 * configuration, never guessed from IP/PTR or silently provisioned in a cloud account.
 * DNS success proves routing, not ownership or external HTTPS reachability.
 */
export async function inspectGeneratedInstanceAddress(
  input: { providerHostname?: string } = {},
): Promise<GeneratedAddressPlan> {
  const publicIpv4 = await currentPublicIpv4();
  if (!isPublicIpv4(publicIpv4)) {
    throw new HttpError("A globally routable public IPv4 address is required for a free server address. Private, shared and reserved addresses cannot be used. Keep existing access or use an outbound tunnel.", 409);
  }
  const source = input.providerHostname?.trim() ? "provider" : "sslip";
  const hostname = normalizePublicHostname(source === "provider" ? input.providerHostname! : `${publicIpv4}.sslip.io`);
  await verifyCaddyDns(hostname, publicIpv4);

  const [needs, firewallAssistance] = await Promise.all([inspectCaddyPortNeeds(), inspectAddressFirewallAssistance()]);
  needs.push({code: "host_firewall_review", blocking: false, detail: firewallAssistance.hostFirewalls.map(item => item.detail).join(" ") + " " + firewallAssistance.hostGuidance});
  needs.push({code: "provider_firewall_review", blocking: false, detail: firewallAssistance.providerGuidance});
  needs.push({ code: "ports_unverified", blocking: false, detail: "Public inbound TCP ports 80 and 443 must reach this server through host and cloud firewalls. This local check cannot confirm outside reachability. GroundControl will not open firewall ports; check your provider or ask for help if HTTPS verification fails." });
  needs.push({ code: "caddy_setup", blocking: false, detail: "Continuing configures Caddy HTTPS for this public, authenticated dashboard and installs Caddy if needed. Existing Caddy is reused; port 3003 remains private. HTTPS and instance identity must pass verification before the address is ready." });
  return {
    hostname, publicUrl: `https://${hostname}`, source, publicIpv4, needs, firewallAssistance,
    canPublish: !needs.some(need => need.blocking),
    stability: source === "sslip"
      ? "Free server address using shared sslip.io DNS. It stays the same while this public IP is assigned to you, not forever. If the IP changes or is released, stop using the old address and reconnect agents. DNS availability and certificate issuance depend on third parties."
      : "Existing provider hostname, verified to route to this server. Its lifetime depends on your provider's hostname and public-IP allocation. No provider resource has been created or changed.",
  };
}
