// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const m = vi.hoisted(() => ({ exec: vi.fn(), account: vi.fn(), zones: vi.fn(), configure: vi.fn(), dns: vi.fn(), removeDns: vi.fn(), tunnel: vi.fn(), removeTunnel: vi.fn(), row: vi.fn(), upsert: vi.fn(), config: new Map<string, string>(), events: [] as string[], resolve: vi.fn() }));
vi.mock("node:dns/promises", () => ({ resolve4: m.resolve }));
vi.mock("node:util", () => ({ promisify: () => async () => ({ stdout: "groundcontrol-pty-ok" }) }));
vi.mock("@/lib/crypto", () => ({ decryptMaybe: (v: string) => v, encryptIfNeeded: (v: string) => v }));
vi.mock("@/lib/runtime", () => ({ isDesktopMode: () => false }));
vi.mock("@/lib/vps", () => ({ shQuote: (v: string) => `'${v}'`, execOnVps: m.exec }));
vi.mock("@/lib/host-exec", () => ({ execOnHost: m.exec }));
vi.mock("@/lib/install-claim", () => ({ installClaimStatus: async () => ({ claimed: true, instanceId: "our-instance" }) }));
vi.mock("@/lib/cloudflare", () => ({ getActiveCloudflareAccount: m.account, listZones: m.zones, updateTunnelConfiguration: m.configure, createTunnel: m.tunnel, deleteTunnel: m.removeTunnel, listDnsRecords: async () => [], createDnsRecord: m.dns, deleteDnsRecord: m.removeDns, updateDnsRecord: m.dns, verifyCloudflareToken: vi.fn() }));
vi.mock("@/lib/prisma", () => { const db = { appConfig: { findUnique: async ({ where }: { where: { key: string } }) => ({ value: m.config.get(where.key) }), upsert: async ({ where, update }: { where: {key: string}, update: {value: string} }) => { m.events.push(`save:${where.key}`); m.config.set(where.key, update.value); } }, cloudflareTunnel: { findFirst: m.row, upsert: m.upsert, update: vi.fn() }, installClaim: { count: async () => 0 } }; return { prisma: { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) } }; });
import { publishWithCloudflare, publishWithCaddy } from "./instance-publish";
beforeEach(() => {
  vi.clearAllMocks(); m.config.clear(); m.events.length = 0;
  m.config.set("groundcontrol_public_url", "https://prior.trycloudflare.com"); m.config.set("groundcontrol_publish_mode", "quick_tunnel"); m.config.set("groundcontrol_publish_evidence", "prior-evidence");
  m.account.mockResolvedValue({ id: 1, accountId: "account", apiToken: "test" }); m.zones.mockResolvedValue([{ id: "zone", name: "example.com" }]); m.configure.mockResolvedValue({}); m.dns.mockResolvedValue({ id: "created-dns" }); m.row.mockResolvedValue(null); m.tunnel.mockResolvedValue({ tunnel: { id: "new-tunnel" }, token: "test" }); m.upsert.mockResolvedValue({ tunnelId: "new-tunnel" }); m.resolve.mockResolvedValue(["203.0.113.1"]);
  m.exec.mockImplementation(async (command: string) => {
    m.events.push(command);
    const stdout = command.includes("NetworkSettings.Networks") ? '{"test-network":{}}' : command.includes("ipify") ? "203.0.113.1" : command.includes("docker port") ? "127.0.0.1:3003" : command.includes(".State.Health") ? "ready" : command.includes(".Mounts") ? "volume:db" : command.includes("printf groundcontrol-host-ok") ? "groundcontrol-host-ok" : command.includes("caddy version") ? "v2" : "";
    return { code: 0, stdout, stderr: "" };
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { m.events.push(`http:${url}`); return new Response(JSON.stringify(url.endsWith("/mcp") ? { result: { tools: [{ name: "deployment.list" }] } } : url.endsWith("/api/auth/claim") ? { instanceId: "our-instance", claimed: true } : url.endsWith("/oauth-authorization-server") ? { issuer: new URL(url).origin, authorization_endpoint: `${new URL(url).origin}/oauth/authorize`, token_endpoint: `${new URL(url).origin}/oauth/token` } : { resource: `${new URL(url).origin}/mcp`, authorization_servers: [new URL(url).origin] })); }));
});
afterEach(() => vi.unstubAllGlobals());
function expectPreserved() {
  expect(m.config.get("groundcontrol_public_url")).toBe("https://prior.trycloudflare.com"); expect(m.config.get("groundcontrol_publish_mode")).toBe("quick_tunnel"); expect(m.config.get("groundcontrol_publish_evidence")).toBe("prior-evidence");
  expect(m.exec.mock.calls.some(([c]) => c.includes("docker rm -f 'groundcontrol-quick-tunnel'"))).toBe(false);
}
it("keeps quick access when account or zone validation fails", async () => {
  m.account.mockResolvedValue(null); await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow("Connect Cloudflare"); expectPreserved();
  m.account.mockResolvedValue({ id: 1, accountId: "a" }); m.zones.mockResolvedValue([]); await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow("No Cloudflare zone"); expectPreserved();
});
it("keeps quick access when tunnel configuration fails", async () => { m.configure.mockRejectedValue(new Error("configuration failed")); await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow("configuration failed"); expectPreserved(); });
it("keeps prior config and evidence when candidate HTTPS fails validation", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith("https:") ? {} : url.endsWith("/mcp") ? { result: { tools: [{ name: "deployment.list" }] } } : { resource: "local" }))));
  await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow("Existing access has not been retired"); expectPreserved();
});
it("verifies candidate before saving identity and retiring the quick bridge", async () => {
  const result = await publishWithCloudflare({ hostname: "app.example.com" }); expect(result.verification.ok).toBe(true);
  const probe = m.events.indexOf("http:https://app.example.com/mcp"); const save = m.events.indexOf("save:groundcontrol_public_url"); const stop = m.events.findIndex(c => c.includes("docker rm -f 'groundcontrol-quick-tunnel'"));
  expect(probe).toBeGreaterThan(-1); expect(save).toBeGreaterThan(probe); expect(stop).toBeGreaterThan(save);
});
it("keeps quick access when Caddy DNS is not ready", async () => { m.resolve.mockResolvedValue([]); await expect(publishWithCaddy({ hostname: "app.example.com" })).rejects.toMatchObject({ code: "DNS_REQUIRED" }); expectPreserved(); });
it("keeps quick access when Caddy configuration fails", async () => { m.exec.mockImplementation(async (c: string) => ({ code: c.includes("GC_CADDY") ? 1 : 0, stdout: c.includes("ipify") ? "203.0.113.1" : c.includes("docker port") ? "127.0.0.1:3003" : c.includes("caddy version") ? "v2" : "", stderr: "configure error" })); await expect(publishWithCaddy({ hostname: "app.example.com" })).rejects.toThrow(); expectPreserved(); });

it("cleans candidate connector and tunnel on failed verification without retiring quick access", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith("https:") ? {} : url.endsWith("/mcp") ? { result: { tools: [{ name: "deployment.list" }] } } : { resource: "local" }))));
  await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow();
  expect(m.removeDns).toHaveBeenCalledWith("zone", "created-dns", expect.anything());
  expect(m.removeTunnel).toHaveBeenCalledWith("new-tunnel", expect.anything());
  expect(m.exec.mock.calls.some(([c]) => c.startsWith("docker rm -f 'gc-control-plane-"))).toBe(true);
  expectPreserved();
});
it("restores Caddy configuration and leaves prior identity on candidate verification failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith("https:") ? {} : url.endsWith("/mcp") ? { result: { tools: [{ name: "deployment.list" }] } } : { resource: "local" }))));
  await expect(publishWithCaddy({ hostname: "app.example.com" })).rejects.toThrow("Existing access has not been retired");
  expect(m.exec.mock.calls.some(([c]) => c.includes("cp /etc/caddy/Caddyfile.gc-before-publish /etc/caddy/Caddyfile"))).toBe(true);
  expectPreserved();
});
it("verifies Caddy access before retiring quick access", async () => {
  expect((await publishWithCaddy({ hostname: "app.example.com" })).verification.ok).toBe(true);
  expect(m.events.findIndex(c => c.includes("docker rm -f 'groundcontrol-quick-tunnel'"))).toBeGreaterThan(m.events.indexOf("http:https://app.example.com/mcp"));
});
it("retains the prior named connector and restores ingress on candidate failure", async () => {
  m.row.mockResolvedValue({ tunnelId: "prior-tunnel", tunnelSecret: "test", connectorId: "old-connector", domains: "old.example.com" });
  m.upsert.mockRejectedValue(new Error("database write failed"));
  await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow("database write failed");
  expect(m.exec.mock.calls.some(([c]) => c.includes("docker rm -f 'old-connector'"))).toBe(false);
  expect(m.configure).toHaveBeenLastCalledWith("prior-tunnel", [{ hostname: "old.example.com", service: "http://groundcontrol-web:3000" }], expect.anything());
  expectPreserved();
});
it.each(["identity", "oauth"])("rejects wrong candidate %s even when HTTP and tools succeed", async (failure) => {
  const original = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https:") && url.endsWith(failure === "identity" ? "/api/auth/claim" : "/.well-known/oauth-authorization-server")) return new Response(JSON.stringify(failure === "identity" ? { instanceId: "another-instance", claimed: true } : { issuer: "https://another.example" }));
    return original(url, init);
  }));
  await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toMatchObject({ status: 502 }); expectPreserved();
});
it("reports unrelated storage failure without blocking a verified access replacement", async () => {
  const original = m.exec.getMockImplementation()!;
  m.exec.mockImplementation((command: string) => command.includes(".Mounts") ? Promise.resolve({ code: 0, stdout: "", stderr: "" }) : original(command));
  const result = await publishWithCloudflare({ hostname: "app.example.com" });
  expect(result.verification.ok).toBe(false); expect(result.verification.checks.storage.status).toBe("failed"); expect(result.verification.checks.publicHttps.status).toBe("ready");
  expect(m.config.get("groundcontrol_public_url")).toBe("https://app.example.com");
});
it("reports cleanup uncertainty if Docker cannot confirm candidate absence", async () => {
  m.upsert.mockRejectedValue(new Error("write failed"));
  const original = m.exec.getMockImplementation()!;
  m.exec.mockImplementation((command: string) => command.includes("remaining=$(docker ps") ? Promise.resolve({ code: 1, stdout: "", stderr: "daemon unavailable" }) : original(command));
  await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow("candidate connector cleanup needs inspection"); expectPreserved();
});
it("reports incomplete old-connector retirement while keeping the verified replacement", async () => {
  const original = m.exec.getMockImplementation()!;
  m.exec.mockImplementation((command: string) => command.includes("remaining=$(docker ps") && command.includes("groundcontrol-quick-tunnel") ? Promise.resolve({ code: 1, stdout: "groundcontrol-quick-tunnel", stderr: "" }) : original(command));
  await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow("New public access was verified and saved, but retiring previous access did not complete");
  expect(m.config.get("groundcontrol_public_url")).toBe("https://app.example.com");
  expect(m.removeTunnel).not.toHaveBeenCalled();
});

it("does not reuse a named tunnel from a different Cloudflare account", async () => {
  m.row.mockImplementation(async ({ where }: { where: { cloudflareAccountId?: number } }) => where.cloudflareAccountId === 1 ? null : {
    tunnelId: "other-account-tunnel", tunnelSecret: "other-secret", connectorId: "other-account-connector", cloudflareAccountId: 2, domains: "old.example.org",
  });
  await publishWithCloudflare({ hostname: "app.example.com" });
  expect(m.row).toHaveBeenCalledWith(expect.objectContaining({ where: { name: "groundcontrol-instance", cloudflareAccountId: 1 } }));
  expect(m.tunnel).toHaveBeenCalledWith("groundcontrol-instance", expect.objectContaining({ id: 1 }));
  expect(m.configure.mock.calls.every(([id]) => id === "new-tunnel")).toBe(true);
  const retirement = m.events.findIndex(c => c.includes("docker rm -f 'other-account-connector'"));
  expect(retirement).toBeGreaterThan(m.events.indexOf("save:groundcontrol_public_url"));
});

it("preserves another account's connector if the new account's candidate fails", async () => {
  m.row.mockImplementation(async ({ where }: { where: { cloudflareAccountId?: number } }) => where.cloudflareAccountId === 1 ? null : {
    tunnelId: "other-account-tunnel", tunnelSecret: "other-secret", connectorId: "other-account-connector", cloudflareAccountId: 2, domains: "old.example.org",
  });
  m.upsert.mockRejectedValue(new Error("database write failed"));
  await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow("database write failed");
  expect(m.removeTunnel).toHaveBeenCalledWith("new-tunnel", expect.objectContaining({ id: 1 }));
  expect(m.configure.mock.calls.every(([id]) => id === "new-tunnel")).toBe(true);
  expect(m.events.some(c => c.includes("docker rm -f 'other-account-connector'"))).toBe(false);
  expectPreserved();
});

it("reports failed Caddy retirement without rolling back the verified new URL", async () => {
  const original = m.exec.getMockImplementation()!;
  m.exec.mockImplementation((command: string) => command.includes("rm -f /etc/caddy/sites/groundcontrol.caddy")
    ? Promise.resolve({ code: 1, stdout: "", stderr: "reload failed" }) : original(command));
  await expect(publishWithCloudflare({ hostname: "app.example.com" })).rejects.toThrow("retiring previous access did not complete");
  expect(m.config.get("groundcontrol_public_url")).toBe("https://app.example.com");
  expect(m.removeTunnel).not.toHaveBeenCalled();
  const command = m.events.find(c => c.includes("rm -f /etc/caddy/sites/groundcontrol.caddy")) || m.exec.mock.calls.map(([c]) => c as string).find(c => c.includes("rm -f /etc/caddy/sites/groundcontrol.caddy"))!;
  expect(command).toContain('[ -f /etc/caddy/sites/groundcontrol.caddy ] || [ -f /etc/caddy/groundcontrol.gc-retirement-pending ]');
  expect(command).toContain('rc-service caddy restart >/dev/null 2>&1 || exit 1');
  expect(command).not.toContain('|| true');
});


it("retries only pending GC retirement, not an unrelated Caddy configuration", async () => {
  await publishWithCloudflare({ hostname: "app.example.com" });
  const command = m.exec.mock.calls.map(([c]) => c as string).find(c => c.includes("groundcontrol.gc-retirement-pending"))!;
  const root = mkdtempSync(join(tmpdir(), "gc-caddy-retirement-"));
  const config = join(root, "caddy");
  const bin = join(root, "bin");
  const marker = join(config, "groundcontrol.gc-retirement-pending");
  try {
    mkdirSync(join(config, "sites"), { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(config, "Caddyfile"), "# unrelated config");
    writeFileSync(join(bin, "caddy"), `#!/bin/sh
if [ "$1" = validate ]; then exit 0; fi
touch '${root}/reloaded'
exit "${"$"}{RELOAD_FAIL:-0}"
`, { mode: 0o755 });
    for (const name of ["systemctl", "rc-service"]) writeFileSync(join(bin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const run = (fail = "0") => execFileSync("/bin/sh", ["-c", command.replaceAll("/etc/caddy", config)], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELOAD_FAIL: fail }, stdio: "pipe",
    });
    run();
    expect(existsSync(join(root, "reloaded"))).toBe(false);
    writeFileSync(join(config, "sites/groundcontrol.caddy"), "# GC route");
    expect(() => run("1")).toThrow();
    expect(existsSync(marker)).toBe(true);
    expect(existsSync(join(config, "sites/groundcontrol.caddy"))).toBe(false);
    run();
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(root, "reloaded"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
