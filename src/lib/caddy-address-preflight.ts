import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";
import { execOnHost } from "./host-exec";
import { HttpError } from "./errors";

export function normalizePublicHostname(value: string) {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
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


/** Bound read-only inspection even when a host transport ignores its timeout option.
 * The underlying probe may finish later; no mutation is dispatched or retried here.
 */
export async function execReadOnlyAddressProbe(command: string, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execOnHost(command, { requireHost: true, timeout: timeoutMs }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HttpError(
          "Host address inspection timed out. Check the host connection and retry; no configuration was changed.", 504
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function currentPublicIpv4() {
  const result = await execReadOnlyAddressProbe(
    "curl -4 -fsS --max-time 8 https://api.ipify.org || curl -4 -fsS --max-time 8 https://ifconfig.co/ip",
    20_000
  );
  const value = result.stdout.trim();
  if (isIP(value) !== 4) throw new Error("Could not determine this VPS public IPv4 address.");
  return value;
}


function normalizeIpv6(address: string) {
  // WHATWG URL canonicalization handles compressed, expanded and mixed-case IPv6.
  return new URL(`http://[${address}]/`).hostname;
}

async function resolvePublishAddresses(hostname: string, type: "A" | "AAAA"): Promise<string[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      type === "A" ? resolve4(hostname) : resolve6(hostname),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("DNS lookup timed out")), 10_000);
      }),
    ]);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException)?.code;
    if (code === "ENODATA" || code === "ENOTFOUND") return [];
    throw new HttpError(
      `Could not check ${type} records for ${hostname}: DNS lookup is unavailable. Retry when DNS resolution is working. Do not change records based on this failed check; existing access is unchanged.`, 502
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function verifyCaddyDns(hostname: string, originIp: string) {
  const resolved = await resolvePublishAddresses(hostname, "A");
  if (!resolved.length || resolved.some(address => address !== originIp)) {
    const error = new Error(
      `DNS for ${hostname} must have only A records pointing to this server (${originIp}). Current A records: ${resolved.join(", ") || "none"}. Review conflicting records with your DNS provider, then retry. GroundControl has not changed DNS or existing access.`
    ) as Error & { code?: string; requiredRecord?: Record<string, string> };
    error.code = "DNS_REQUIRED";
    error.requiredRecord = { type: "A", name: hostname, content: originIp };
    throw error;
  }

  const ipv6 = await resolvePublishAddresses(hostname, "AAAA");
  if (ipv6.length) {
    let hostAddresses: string[];
    try {
      // Read the actual host namespace, not the web container's interfaces.
      const result = await execReadOnlyAddressProbe(
        "command -v ip >/dev/null 2>&1 || exit 127; ip -6 -o address show scope global",
        10_000
      );
      if (result.code !== 0) throw new Error("IPv6 inspection unavailable");
      hostAddresses = result.stdout.split("\n")
        .filter(line => !/\b(tentative|dadfailed)\b/.test(line))
        .flatMap(line => {
          const match = line.match(/\binet6\s+([^\s/]+)\/\d+\b/);
          return match && isIP(match[1]) === 6 ? [normalizeIpv6(match[1])] : [];
        });
    } catch {
      throw new HttpError(
        `Cannot verify the AAAA records for ${hostname} against this server's IPv6 addresses. Check host access and that the ip command is available, then retry. Do not change DNS based on this failed check. Existing access is unchanged.`, 502
      );
    }
    const conflicting = ipv6.filter(address => !hostAddresses.includes(normalizeIpv6(address)));
    if (conflicting.length) {
      throw new HttpError(
        `AAAA records for ${hostname} point to IPv6 addresses not confirmed on this server: ${conflicting.join(", ")}. Review these records with your DNS provider; correct them to this server's public IPv6 addresses, or remove them only if IPv6 is not intended. GroundControl has not changed DNS or existing access.`, 409
      );
    }
  }

}
