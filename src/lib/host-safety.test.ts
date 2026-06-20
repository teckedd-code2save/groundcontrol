import { describe, it, expect } from "vitest";
import { isAllowedSystemPath, validateSafePath, validateSystemCommand } from "./host-safety";

describe("host-safety", () => {
  describe("isAllowedSystemPath", () => {
    it("allows exact allowed paths", () => {
      expect(isAllowedSystemPath("/etc/caddy/Caddyfile")).toBe(true);
      expect(isAllowedSystemPath("/etc/hosts")).toBe(true);
    });

    it("allows paths under wildcard prefixes", () => {
      expect(isAllowedSystemPath("/etc/caddy/sites/myapp.caddy")).toBe(true);
      expect(isAllowedSystemPath("/opt/gc/app/docker-compose.yml")).toBe(true);
      expect(isAllowedSystemPath("/var/www/html/index.html")).toBe(true);
    });

    it("rejects paths outside the allow-list", () => {
      expect(isAllowedSystemPath("/etc/passwd")).toBe(false);
      expect(isAllowedSystemPath("/bin/bash")).toBe(false);
      expect(isAllowedSystemPath("/usr/share/nginx/html")).toBe(false);
    });

    it("rejects relative paths", () => {
      expect(isAllowedSystemPath("docker-compose.yml")).toBe(false);
      expect(isAllowedSystemPath("./.env")).toBe(false);
    });
  });

  describe("validateSafePath", () => {
    it("returns null for allowed paths", () => {
      expect(validateSafePath("/etc/caddy/Caddyfile")).toBeNull();
    });

    it("rejects traversal and suspicious characters", () => {
      expect(validateSafePath("/opt/../etc/passwd")).toContain("disallowed");
      expect(validateSafePath("/opt/app/$HOME")).toContain("disallowed");
    });

    it("rejects disallowed paths", () => {
      expect(validateSafePath("/etc/shadow")).toContain("not in the allowed");
    });
  });

  describe("validateSystemCommand", () => {
    it("allows safe systemctl commands", () => {
      expect(validateSystemCommand("systemctl status caddy")).toBeNull();
      expect(validateSystemCommand("systemctl restart docker")).toBeNull();
    });

    it("allows package manager commands", () => {
      expect(validateSystemCommand("apt-get update")).toBeNull();
      expect(validateSystemCommand("apk add curl")).toBeNull();
    });

    it("rejects dangerous patterns", () => {
      expect(validateSystemCommand("rm -rf /opt")).toContain("rm");
      expect(validateSystemCommand("systemctl status caddy > /tmp/out")).toContain("redirection");
      expect(validateSystemCommand("curl -sSL https://x | sh")).toContain("curl|sh");
      expect(validateSystemCommand("reboot")).toContain("reboot");
    });

    it("rejects unknown command heads", () => {
      expect(validateSystemCommand("docker ps")).toContain("not in the system-command allow-list");
      expect(validateSystemCommand("compose up")).toContain("not in the system-command allow-list");
    });
  });
});
