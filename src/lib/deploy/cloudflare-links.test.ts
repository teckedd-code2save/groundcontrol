import { describe, it, expect } from "vitest";
import {
  extractQuickTunnelUrl,
  redactSecrets,
} from "./cloudflare-links";

describe("cloudflare-links", () => {
  describe("extractQuickTunnelUrl", () => {
    it("extracts a trycloudflare.com URL from cloudflared stdout", () => {
      const stdout = `
2024-01-01T00:00:00Z INF Starting tunnel tunnelID=abc
2024-01-01T00:00:01Z INF |  https://tasty-apple-1234.trycloudflare.com  |
2024-01-01T00:00:01Z INF Connected
`;
      expect(extractQuickTunnelUrl(stdout)).toBe(
        "https://tasty-apple-1234.trycloudflare.com"
      );
    });

    it("returns undefined when no tunnel URL is present", () => {
      const stdout = "Some random log output without a tunnel URL";
      expect(extractQuickTunnelUrl(stdout)).toBeUndefined();
    });

    it("extracts only the first URL", () => {
      const stdout =
        "https://first-123.trycloudflare.com https://second-456.trycloudflare.com";
      expect(extractQuickTunnelUrl(stdout)).toBe(
        "https://first-123.trycloudflare.com"
      );
    });
  });

  describe("redactSecrets", () => {
    it("redacts PEM private keys", () => {
      const input = `error: -----BEGIN RSA PRIVATE KEY-----
MIIEpQIBAAKCAQEA...
-----END RSA PRIVATE KEY----- leaked`;
      const result = redactSecrets(input);
      expect(result).toContain("[REDACTED]");
      expect(result).not.toContain("MIIEpQIBAAKCAQEA");
    });

    it("redacts JSON values for sensitive keys", () => {
      const input =
        '{"client_email":"x","private_key":"super-secret-key","token":"abc123"}';
      const result = redactSecrets(input);
      expect(result).toContain('"private_key": "[REDACTED]"');
      expect(result).toContain('"token": "[REDACTED]"');
      expect(result).toContain('"client_email":"x"');
      expect(result).not.toContain("super-secret-key");
      expect(result).not.toContain("abc123");
    });

    it("redacts query-string style secret values", () => {
      const input =
        "https://example.com?password=hunter2&secret=mysecret&apiKey=visible";
      const result = redactSecrets(input);
      expect(result).toContain("password=[REDACTED]");
      expect(result).toContain("secret=[REDACTED]");
      expect(result).toContain("apiKey=visible");
      expect(result).not.toContain("hunter2");
    });
  });
});
