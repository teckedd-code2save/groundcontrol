import { BlockList, isIP } from "node:net";

// Exclude special-use and non-unicast ranges. Do not accept URLs, hostnames,
// ports, alternate IPv4 encodings or IPv6 mapped addresses.
const reserved = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) reserved.addSubnet(network, prefix, "ipv4");

export function publicIpv4(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 15 || isIP(value) !== 4) return null;
  return reserved.check(value, "ipv4") ? null : value;
}

export const DIRECT_IPV4_CADDY_VERSION = "2.11.9";

export function directIpv4Caddyfile(ip: string, port: number, routeKey: string) {
  if (!publicIpv4(ip) || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^[a-f0-9]{64}$/.test(routeKey)) throw new Error("Invalid direct IPv4 route parameters");
  return [
    `https://${ip} {`,
    "  tls {",
    "    issuer acme https://acme-v02.api.letsencrypt.org/directory {",
    "      profile shortlived",
    "      disable_http_challenge",
    "    }",
    "  }",
    "  handle /api/instance/direct-ipv4-proof {",
    `    reverse_proxy 127.0.0.1:${port} {`,
    `      header_up X-GroundControl-IP-Route ${routeKey}`,
    "    }",
    "  }",
    "  handle {",
    `    reverse_proxy 127.0.0.1:${port}`,
    "  }",
    "}",
  ].join("\n");
}
