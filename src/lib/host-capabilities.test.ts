import { describe, it, expect } from "vitest";
import { formatCapabilitiesForPrompt, type HostCapabilities } from "./host-capabilities";

function makeCaps(partial: Partial<HostCapabilities> = {}): HostCapabilities {
  return {
    layout: {
      osFamily: "debian",
      osName: "Debian GNU/Linux 12",
      osVersion: "12",
      dockerAvailable: true,
      caddyAvailable: false,
      nodeAvailable: false,
      hasK3s: false,
      hasKubectl: false,
      hasHelm: false,
      kubeconfigPath: "/etc/rancher/k3s/k3s.yaml",
      composeCommand: "docker compose",
      projectRoot: "/opt",
      caddySitesDir: "/etc/caddy/sites",
      caddyFile: "/etc/caddy/Caddyfile",
      nginxSitesDir: "/etc/nginx/sites-available",
      nginxLogPath: "/var/log/nginx/error.log",
      staticRoot: "/var/www",
      sshDefaultCwd: "/root",
      ...partial.layout,
    },
    capabilities: {
      osFamily: "debian",
      initSystem: "systemd",
      hasDocker: true,
      hasCaddy: false,
      hasNginx: false,
      hasNode: false,
      hasK3s: false,
      hasKubectl: false,
      hasHelm: false,
      hasTerraform: false,
      hasCloudflared: false,
      hasSystemctl: true,
      hasService: false,
      networkTool: "ss",
      containerized: false,
      hostExecAvailable: false,
      ...partial.capabilities,
    },
    installed: {
      docker: true,
      caddy: false,
      nginx: false,
      node: false,
      git: false,
      k3s: false,
      kubectl: false,
      helm: false,
      terraform: false,
      cloudflared: false,
      ...partial.installed,
    },
  };
}

describe("host-capabilities", () => {
  describe("formatCapabilitiesForPrompt", () => {
    it("summarizes OS, init, installed and missing tools, and paths", () => {
      const caps = makeCaps();
      const summary = formatCapabilitiesForPrompt(caps);
      expect(summary).toContain("Debian GNU/Linux 12");
      expect(summary).toContain("systemd");
      expect(summary).toContain("Docker");
      expect(summary).toContain("missing:");
      expect(summary).toContain("projectRoot=/opt");
      expect(summary).toContain("compose: docker compose");
    });

    it("lists all installed tools when everything is present", () => {
      const caps = makeCaps({
        installed: {
          docker: true,
          caddy: true,
          nginx: true,
          node: true,
          git: true,
          k3s: true,
          kubectl: true,
          helm: true,
          terraform: true,
          cloudflared: true,
        },
      });
      const summary = formatCapabilitiesForPrompt(caps);
      expect(summary).toContain("installed:");
      expect(summary).not.toContain("missing:");
    });
  });
});
