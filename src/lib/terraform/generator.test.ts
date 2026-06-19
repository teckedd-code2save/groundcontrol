import { describe, it, expect } from "vitest";
import { generateHetznerStack, generateHcl } from "./generator";

describe("terraform generator", () => {
  describe("generateHetznerStack", () => {
    it("includes hcloud_server and cloudflare_record blocks", () => {
      const hcl = generateHetznerStack({
        name: "gc-test",
        serverType: "cx22",
        location: "nbg1",
        image: "ubuntu-22.04",
        cloudflareZoneId: "zone-123",
        subdomain: "test",
      });

      expect(hcl).toContain('resource "hcloud_server" "gc"');
      expect(hcl).toContain('resource "cloudflare_record" "gc"');
      expect(hcl).toContain('hcloud_ssh_key');
      expect(hcl).toContain('data "cloudflare_zone" "gc"');
    });

    it("exposes expected outputs", () => {
      const hcl = generateHetznerStack({
        name: "gc-test",
        serverType: "cx22",
        location: "nbg1",
        image: "ubuntu-22.04",
      });

      expect(hcl).toContain('output "server_ip"');
      expect(hcl).toContain('output "server_id"');
      expect(hcl).toContain('output "dns_record"');
      expect(hcl).toContain('output "ssh_command"');
    });

    it("includes cloud-init user data for docker", () => {
      const hcl = generateHetznerStack({
        name: "gc-test",
        serverType: "cx22",
        location: "nbg1",
        image: "ubuntu-22.04",
        installK3s: true,
      });

      expect(hcl).toContain("#cloud-config");
      expect(hcl).toContain("docker.io");
      expect(hcl).toContain("get.k3s.io");
      expect(hcl).toContain('variable "install_k3s"');
    });
  });

  describe("generateHcl", () => {
    it("dispatches to the hetzner generator", () => {
      const hcl = generateHcl({ provider: "hetzner", name: "gc-dispatch" });
      expect(hcl).toContain('resource "hcloud_server" "gc"');
      expect(hcl).toContain('variable "hcloud_token"');
    });

    it("throws for unsupported providers", () => {
      expect(() =>
        generateHcl({ provider: "unknown", name: "gc-bad" })
      ).toThrow("Unsupported Terraform provider");
    });
  });
});
