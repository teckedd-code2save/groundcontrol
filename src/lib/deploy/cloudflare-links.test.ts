import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ensureCloudflared,
  extractQuickTunnelUrl,
  redactSecrets,
} from "./cloudflare-links";

const mocks = vi.hoisted(() => ({
  execOnVps: vi.fn(),
  getActiveVps: vi.fn(),
  shQuote: vi.fn((s: string) => `'${s}'`),
  installCloudflared: vi.fn(),
  listDnsRecords: vi.fn(),
  createDnsRecord: vi.fn(),
  updateDnsRecord: vi.fn(),
  getZone: vi.fn(),
  getVpsPublicIp: vi.fn(),
  execKubectl: vi.fn(),
}));

vi.mock("@/lib/vps", () => ({
  execOnVps: mocks.execOnVps,
  getActiveVps: mocks.getActiveVps,
  shQuote: mocks.shQuote,
}));

vi.mock("@/lib/bootstrap", () => ({
  installCloudflared: mocks.installCloudflared,
}));

vi.mock("@/lib/cloudflare", () => ({
  listDnsRecords: mocks.listDnsRecords,
  createDnsRecord: mocks.createDnsRecord,
  updateDnsRecord: mocks.updateDnsRecord,
  getZone: mocks.getZone,
}));

vi.mock("@/lib/k8s/utils", () => ({
  getVpsPublicIp: mocks.getVpsPublicIp,
  execKubectl: mocks.execKubectl,
}));

const vps = {
  id: 1,
  host: "203.0.113.10",
  port: 22,
  username: "root",
  isLocal: false,
};

function execResult(stdout = "", stderr = "", code = 0) {
  return { stdout, stderr, code };
}

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
      const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEpQIBAAKCAQEA
-----END RSA PRIVATE KEY-----`;
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

  describe("ensureCloudflared", () => {
    beforeEach(() => {
      mocks.execOnVps.mockReset();
      mocks.installCloudflared.mockReset();
    });

    it("returns the existing binary without installing when cloudflared is present", async () => {
      mocks.execOnVps.mockResolvedValue(
        execResult("/usr/local/bin/cloudflared\n")
      );

      const result = await ensureCloudflared(vps);

      expect(result).toEqual({
        binary: "/usr/local/bin/cloudflared",
        autoInstalled: false,
      });
      expect(mocks.installCloudflared).not.toHaveBeenCalled();
    });

    it("auto-installs cloudflared when the binary is missing and the install succeeds", async () => {
      mocks.execOnVps
        .mockResolvedValueOnce(execResult("")) // first check: missing
        .mockResolvedValueOnce(execResult("/usr/local/bin/cloudflared\n")); // recheck after install
      mocks.installCloudflared.mockResolvedValue({
        success: true,
        output: "installed cloudflared",
        error: "",
      });

      const result = await ensureCloudflared(vps);

      expect(result).toEqual({
        binary: "/usr/local/bin/cloudflared",
        autoInstalled: true,
      });
      expect(mocks.installCloudflared).toHaveBeenCalledWith(vps);
    });

    it("throws a descriptive error with install instructions when auto-install fails", async () => {
      mocks.execOnVps.mockResolvedValue(execResult(""));
      mocks.installCloudflared.mockResolvedValue({
        success: false,
        output: "",
        error: "curl: (22) The requested URL returned error: 404",
      });

      const error = (await ensureCloudflared(vps).catch((e: unknown) => e)) as Error;
      expect(error.message).toMatch(/automatic install failed/);
      expect(error.message).toMatch(/Install it manually/);
      expect(error.message).toContain("Install error: curl: (22)");
    });

    it("throws when the binary still cannot be found after a successful install", async () => {
      mocks.execOnVps.mockResolvedValue(execResult(""));
      mocks.installCloudflared.mockResolvedValue({
        success: true,
        output: "installed",
        error: "",
      });

      const error = (await ensureCloudflared(vps).catch((e: unknown) => e)) as Error;
      expect(error.message).toMatch(/installed on the target VPS but is not on PATH/);
    });
  });
});
