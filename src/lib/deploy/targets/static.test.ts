import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, DeploymentTarget, Deployment } from "@prisma/client";
import type { DeployContext } from "./types";

/**
 * Static deploy target: proxy detection + Caddy/Nginx site config output.
 * All remote work goes through execOnVps() from @/lib/vps, which is mocked
 * here so the adapter's command construction is locked down deterministically.
 */

const { execOnVpsMock, getSystemConfigMock } = vi.hoisted(() => ({
  execOnVpsMock: vi.fn(),
  getSystemConfigMock: vi.fn(),
}));

vi.mock("@/lib/vps", () => ({
  execOnVps: execOnVpsMock,
  getSystemConfig: getSystemConfigMock,
  // Mirrors the real shQuote in src/lib/vps.ts.
  shQuote: (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`,
}));

import {
  createStaticTarget,
  detectReverseProxy,
  nginxServerBlock,
} from "./static";

const mockProject = {
  id: 1,
  slug: "test-project",
  name: "Test Project",
  repoUrl: null,
  path: "/opt/test-project",
  dockerfile: null,
  buildCommand: null,
  outputDir: null,
  domain: null,
  envVars: null,
  caddyFile: null,
  dockerCompose: null,
  category: "static",
  status: "unknown",
  lastDeploy: null,
  projectGroupId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Project;

const mockTarget = (configJson: string = "{}"): DeploymentTarget => ({
  id: 1,
  name: "test-target",
  type: "static",
  vpsConfigId: null,
  cloudProviderAccountId: null,
  configJson,
  isActive: false,
  dnsRecordId: null,
  dnsRecordName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const mockSystemConfig = {
  staticRoot: "/var/www",
  caddySitesDir: "/etc/caddy/sites",
  caddyFile: "/etc/caddy/Caddyfile",
  nginxSitesDir: "/etc/nginx/sites-available",
};

function makeCtx(): DeployContext {
  return { vps: null, env: {}, secrets: {}, log: vi.fn() };
}

function commands(): string[] {
  return execOnVpsMock.mock.calls.map((call) => String(call[0]));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("detectReverseProxy", () => {
  it("detects caddy when caddy is installed", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "caddy", stderr: "", code: 0 });
    await expect(detectReverseProxy(null)).resolves.toBe("caddy");
    expect(execOnVpsMock).toHaveBeenCalledWith(
      expect.stringContaining("command -v caddy"),
      null
    );
  });

  it("detects nginx when caddy is absent", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "nginx", stderr: "", code: 0 });
    await expect(detectReverseProxy(null)).resolves.toBe("nginx");
  });

  it("returns none when neither proxy is installed", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "none", stderr: "", code: 0 });
    await expect(detectReverseProxy(null)).resolves.toBe("none");
  });
});

describe("nginxServerBlock", () => {
  it("renders a server block for the domain and static dir", () => {
    const block = nginxServerBlock({
      domain: "example.com",
      staticDir: "/var/www/test-project",
      extra: "",
    });
    expect(block).toContain("server {");
    expect(block).toContain("    listen 80;");
    expect(block).toContain("    server_name example.com;");
    expect(block).toContain("    root /var/www/test-project;");
    expect(block).toContain("    index index.html;");
    expect(block).toContain("    try_files $uri $uri/ =404;");
    expect(block).toContain("    gzip on;");
    expect(block.trimEnd()).toMatch(/\}\s*$/);
  });

  it("indents extra directives inside the block", () => {
    const block = nginxServerBlock({
      domain: "example.com",
      staticDir: "/var/www/test-project",
      extra:
        "client_max_body_size 10m;\n\nreturn 301 https://www.example.com$request_uri;",
    });
    expect(block).toContain("    client_max_body_size 10m;");
    expect(block).toContain(
      "    return 301 https://www.example.com$request_uri;"
    );
  });
});

describe("static target deploy", () => {
  const project = { ...mockProject, domain: "example.com" };

  it("writes an Nginx site block + symlink and reloads nginx on Nginx hosts", async () => {
    // Default responses let proxy detection (which reads stdout) resolve to
    // nginx; deploy does not inspect stdout elsewhere.
    execOnVpsMock.mockResolvedValue({ stdout: "nginx", stderr: "", code: 0 });
    getSystemConfigMock.mockResolvedValue(mockSystemConfig);

    const target = createStaticTarget(project, mockTarget());
    const result = await target.deploy(project, {} as Deployment, makeCtx());

    expect(result.publicUrl).toBe("http://example.com");
    expect(getSystemConfigMock).toHaveBeenCalled();

    const cmds = commands();
    expect(
      cmds.some((c) => c.includes("mkdir -p '/etc/nginx/sites-available'"))
    ).toBe(true);
    expect(
      cmds.some((c) =>
        c.includes("'/etc/nginx/sites-available/example.com.conf'")
      )
    ).toBe(true);
    // Debian layout: symlink into sites-enabled.
    expect(cmds.some((c) => c.includes("ln -sf"))).toBe(true);
    expect(
      cmds.some((c) =>
        c.includes("'/etc/nginx/sites-enabled/example.com.conf'")
      )
    ).toBe(true);
    // Validate before reload.
    expect(cmds.some((c) => c.includes("nginx -t 2>&1"))).toBe(true);
    expect(
      cmds.some((c) => c.includes("systemctl reload nginx"))
    ).toBe(true);
    // Caddy must not be touched on Nginx hosts.
    expect(cmds.some((c) => c.includes("Caddyfile"))).toBe(false);
    expect(cmds.some((c) => c.includes("caddy reload"))).toBe(false);
  });

  it("keeps the Caddyfile path when Caddy is the proxy", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "caddy", stderr: "", code: 0 });
    getSystemConfigMock.mockResolvedValue(mockSystemConfig);

    const target = createStaticTarget(project, mockTarget());
    const result = await target.deploy(project, {} as Deployment, makeCtx());

    expect(result.publicUrl).toBe("https://example.com");
    const cmds = commands();
    expect(
      cmds.some((c) => c.includes("'/etc/caddy/sites/example.com.caddy'"))
    ).toBe(true);
    expect(cmds.some((c) => c.includes("caddy reload"))).toBe(true);
    expect(cmds.some((c) => c.includes("nginx -t"))).toBe(false);
  });

  it("falls back to Caddy behavior when no proxy is detected", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "none", stderr: "", code: 0 });
    getSystemConfigMock.mockResolvedValue(mockSystemConfig);

    const target = createStaticTarget(project, mockTarget());
    const result = await target.deploy(project, {} as Deployment, makeCtx());

    expect(result.publicUrl).toBe("https://example.com");
    expect(
      commands().some((c) => c.includes("'/etc/caddy/sites/example.com.caddy'"))
    ).toBe(true);
  });

  it("passes extraNginx directives through to the server block", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "nginx", stderr: "", code: 0 });
    getSystemConfigMock.mockResolvedValue(mockSystemConfig);

    const target = createStaticTarget(
      project,
      mockTarget(JSON.stringify({ extraNginx: "client_max_body_size 20m;" }))
    );
    await target.deploy(project, {} as Deployment, makeCtx());

    expect(
      commands().some((c) => c.includes("client_max_body_size 20m;"))
    ).toBe(true);
  });

  it("skips proxy config entirely when no domain is set", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    getSystemConfigMock.mockResolvedValue(mockSystemConfig);

    const target = createStaticTarget(mockProject, mockTarget());
    const result = await target.deploy(
      mockProject,
      {} as Deployment,
      makeCtx()
    );

    expect(result.publicUrl).toBeUndefined();
    expect(commands().some((c) => c.includes("command -v caddy"))).toBe(false);
  });
});

describe("static target rollback", () => {
  it("swaps directories without reloading Nginx", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "nginx", stderr: "", code: 0 });
    // The prev-dir existence check is the first call and reads stdout.
    execOnVpsMock.mockResolvedValueOnce({
      stdout: "yes",
      stderr: "",
      code: 0,
    });
    getSystemConfigMock.mockResolvedValue(mockSystemConfig);

    const target = createStaticTarget(
      { ...mockProject, domain: "example.com" },
      mockTarget()
    );
    await target.rollback({} as Deployment, makeCtx());

    const cmds = commands();
    expect(
      cmds.some((c) => c.includes("test-project.prev"))
    ).toBe(true);
    // Nginx serves static files from disk; rollback must not touch it.
    expect(cmds.some((c) => c.includes("caddy reload"))).toBe(false);
    expect(cmds.some((c) => c.includes("systemctl reload nginx"))).toBe(false);
  });

  it("reloads Caddy when Caddy is the proxy", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "caddy", stderr: "", code: 0 });
    execOnVpsMock.mockResolvedValueOnce({
      stdout: "yes",
      stderr: "",
      code: 0,
    });
    getSystemConfigMock.mockResolvedValue(mockSystemConfig);

    const target = createStaticTarget(
      { ...mockProject, domain: "example.com" },
      mockTarget()
    );
    await target.rollback({} as Deployment, makeCtx());

    expect(
      commands().some((c) => c.includes("caddy reload"))
    ).toBe(true);
  });
});

describe("static target destroy", () => {
  const project = { ...mockProject, domain: "example.com" };

  it("removes the Nginx config file and symlink, then reloads after nginx -t", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "nginx", stderr: "", code: 0 });
    getSystemConfigMock.mockResolvedValue(mockSystemConfig);

    const target = createStaticTarget(project, mockTarget());
    await target.destroy(project, makeCtx());

    const cmds = commands();
    expect(
      cmds.some((c) =>
        c.includes(
          "rm -f '/etc/nginx/sites-available/example.com.conf' '/etc/nginx/sites-enabled/example.com.conf'"
        )
      )
    ).toBe(true);
    expect(cmds.some((c) => c.includes("nginx -t 2>&1"))).toBe(true);
    expect(
      cmds.some((c) => c.includes("systemctl reload nginx"))
    ).toBe(true);
  });

  it("removes the Caddyfile site block when Caddy is the proxy", async () => {
    execOnVpsMock.mockResolvedValue({ stdout: "caddy", stderr: "", code: 0 });
    getSystemConfigMock.mockResolvedValue(mockSystemConfig);

    const target = createStaticTarget(project, mockTarget());
    await target.destroy(project, makeCtx());

    const cmds = commands();
    expect(
      cmds.some((c) => c.includes("rm -f '/etc/caddy/sites/example.com.caddy'"))
    ).toBe(true);
    expect(cmds.some((c) => c.includes("caddy reload"))).toBe(true);
  });
});
