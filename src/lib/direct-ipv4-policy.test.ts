import { describe, expect, it } from "vitest";
import { directIpv4Caddyfile, publicIpv4 } from "./direct-ipv4-policy";

describe("reserved IPv4 rehearsal", () => {
  it.each([
    "", "https://8.8.8.8", "8.8.8.8:443", "8.8.8.8:8443", "example.com",
    "::ffff:8.8.8.8", "2606:4700::1111", "010.8.8.8", "134744072", "127.0.0.1",
    "10.3.1.2", "100.64.0.1", "169.254.169.254", "172.31.0.1", "192.168.1.1",
    "198.19.0.1", "192.0.2.1", "203.0.113.1", "224.2.0.1", "255.255.255.255",
  ])("rejects %s", (ip) => expect(publicIpv4(ip)).toBe(null));
  it("accepts strict public unicast syntax without assuming reservation", () => {
    expect(publicIpv4("8.8.8.8")).toBe("8.8.8.8");
  });
  it("emits a single exact site with explicit public short-lived issuer and loopback upstream", () => {
    const config = directIpv4Caddyfile("8.8.8.8", 3003, "c".repeat(64));
    expect(config.startsWith("https://8.8.8.8 {")).toBe(true);
    expect(config).toContain("issuer acme https://acme-v02.api.letsencrypt.org/directory");
    expect(config).toContain("profile shortlived");
    expect(config).toContain("disable_http_challenge");
    expect(config).toContain("reverse_proxy 127.0.0.1:3003");
    expect(config).not.toMatch(/tls internal|zerossl|import|0\.0\.0\.0/);
    expect(() => directIpv4Caddyfile("8.8.8.8", 3003, "x\nfoo")).toThrow();
  });
});
