// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ exec: vi.fn(), account: vi.fn(), zones: vi.fn(), configure: vi.fn(), dns: vi.fn(), removeDns: vi.fn(), tunnel: vi.fn(), removeTunnel: vi.fn(), row: vi.fn(), upsert: vi.fn(), failConfig: "", config: new Map<string, string>(), events: [] as string[], resolve: vi.fn(), resolve6: vi.fn() }));
vi.mock("node:dns/promises", () => ({ resolve4: m.resolve, resolve6: m.resolve6 }));
vi.mock("node:util", () => ({ promisify: () => async () => ({ stdout: "groundcontrol-pty-ok" }) }));
vi.mock("@/lib/crypto", () => ({ decryptMaybe: (v: string) => v, encryptIfNeeded: (v: string) => v }));
vi.mock("@/lib/runtime", () => ({ isDesktopMode: () => false }));
vi.mock("@/lib/vps", () => ({ shQuote: (v: string) => `'${v}'`, execOnVps: m.exec }));
vi.mock("@/lib/host-exec", () => ({ execOnHost: m.exec }));
vi.mock("@/lib/install-claim", () => ({ installClaimStatus: async () => ({ claimed: true, instanceId: "our-instance" }) }));
vi.mock("@/lib/cloudflare", () => ({ getActiveCloudflareAccount: m.account, listZones: m.zones, updateTunnelConfiguration: m.configure, createTunnel: m.tunnel, deleteTunnel: m.removeTunnel, listDnsRecords: async () => [], createDnsRecord: m.dns, deleteDnsRecord: m.removeDns, updateDnsRecord: m.dns, verifyCloudflareToken: vi.fn() }));
vi.mock("@/lib/prisma", () => { const db = { appConfig: { create: async ({data}: {data:{key:string;value:string}}) => { if(m.config.has(data.key)) throw Object.assign(new Error("locked"),{code:"P2002"}); m.config.set(data.key,data.value); }, deleteMany: async ({where}: {where:{key:string;value:string}}) => { if(m.config.get(where.key)===where.value) m.config.delete(where.key); }, findUnique: async ({ where }: { where: { key: string } }) => ({ value: m.config.get(where.key) }), upsert: async ({ where, update }: { where: {key: string}, update: {value: string} }) => { if (m.failConfig === where.key) throw new Error("config write failed"); m.events.push(`save:${where.key}`); m.config.set(where.key, update.value); } }, cloudflareTunnel: { findFirst: m.row, upsert: m.upsert, update: vi.fn() }, installClaim: { count: async () => 0 } }; return { prisma: { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => { const snapshot = new Map(m.config); try { return await callback(db); } catch(error) { m.config.clear(); snapshot.forEach((v,k)=>m.config.set(k,v)); throw error; } } } }; });
import { publishWithCloudflare, publishWithCaddy, keepInstancePrivate, publishQuickTunnel, instancePublishStatus } from "./instance-publish";
beforeEach(() => {
  vi.clearAllMocks(); m.failConfig = ""; m.resolve6.mockResolvedValue([]); m.config.clear(); m.events.length = 0;
  m.config.set("groundcontrol_public_url", "https://prior.trycloudflare.com"); m.config.set("groundcontrol_publish_mode", "quick_tunnel"); m.config.set("groundcontrol_publish_evidence", "prior-evidence");
  m.account.mockResolvedValue({ id: 1, accountId: "account", apiToken: "test" }); m.zones.mockResolvedValue([{ id: "zone", name: "example.com" }]); m.configure.mockResolvedValue({}); m.dns.mockResolvedValue({ id: "created-dns" }); m.row.mockResolvedValue(null); m.tunnel.mockResolvedValue({ tunnel: { id: "new-tunnel" }, token: "test" }); m.upsert.mockResolvedValue({ tunnelId: "new-tunnel" }); m.resolve.mockResolvedValue(["203.0.113.1"]);
  m.exec.mockImplementation(async (command: string) => {
    m.events.push(command);
    const stdout = command.includes(".State.Running") ? "true" : command.includes("NetworkSettings.Networks") ? '{"test-network":{}}' : command.includes("ipify") ? "203.0.113.1" : command.includes("docker port") ? "127.0.0.1:3003" : command.includes(".State.Health") ? "ready" : command.includes(".Mounts") ? "volume:db" : command.includes("printf groundcontrol-host-ok") ? "groundcontrol-host-ok" : command.includes("caddy version") ? "v2" : "";
    return { code: 0, stdout, stderr: "" };
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { m.events.push(`http:${url}`); return new Response(JSON.stringify(url.endsWith("/mcp") ? { result: { tools: [{ name: "deployment.list" }] } } : url.endsWith("/api/auth/claim") ? { instanceId: "our-instance", claimed: true } : url.endsWith("/oauth-authorization-server") ? { issuer: (m.config.get("groundcontrol_canonical_url") || m.config.get("groundcontrol_public_url")), authorization_endpoint: `${(m.config.get("groundcontrol_canonical_url") || m.config.get("groundcontrol_public_url"))}/oauth/authorize`, token_endpoint: `${(m.config.get("groundcontrol_canonical_url") || m.config.get("groundcontrol_public_url"))}/oauth/token` } : { resource: `${(m.config.get("groundcontrol_canonical_url") || m.config.get("groundcontrol_public_url"))}/mcp`, authorization_servers: [(m.config.get("groundcontrol_canonical_url") || m.config.get("groundcontrol_public_url"))] })); }));
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
it("verifies candidate before saving identity and retains the quick bridge for response handoff", async () => {
  const result = await publishWithCloudflare({ hostname: "app.example.com" }); expect(result.verification.ok).toBe(true);
  const probe = m.events.indexOf("http:https://app.example.com/mcp"); const save = m.events.indexOf("save:groundcontrol_public_url"); const stop = m.events.findIndex(c => c.includes("docker rm -f 'groundcontrol-quick-tunnel'"));
  expect(probe).toBeGreaterThan(-1); expect(save).toBeGreaterThan(probe); expect(stop).toBe(-1); expect(result.retainedBootstrapUrl).toBe("https://prior.trycloudflare.com");
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
  expect(m.exec.mock.calls.some(([c]) => c.includes("rm -f '/etc/caddy/groundcontrol-sites/groundcontrol-"))).toBe(true);
  expectPreserved();
});
it("verifies Caddy access and retains quick access through response handoff", async () => {
  expect((await publishWithCaddy({ hostname: "app.example.com" })).verification.ok).toBe(true);
  expect(m.events.findIndex(c => c.includes("docker rm -f 'groundcontrol-quick-tunnel'"))).toBe(-1);
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
it("does not retire the named connector carrying an alias publish response", async () => {
  m.row.mockResolvedValue({tunnelId:"prior-tunnel",tunnelSecret:"test",connectorId:"old-connector",domains:"old.example.com"});
  m.config.set("groundcontrol_public_url","https://old.example.com");
  m.config.set("groundcontrol_publish_mode","cloudflare");
  const result=await publishWithCloudflare({hostname:"app.example.com"});
  expect(result.verification.checks.publicHttps.status).toBe("ready");
  expect(result.retainedConnectorCount).toBe(1);
  expect(m.exec.mock.calls.some(([c])=>c.includes("docker rm -f 'old-connector'") || c.includes("docker rm -f 'groundcontrol-quick-tunnel'"))).toBe(false);
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
  expect(retirement).toBe(-1);
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

it("preserves old Caddy routes when adding Cloudflare access", async () => {
  m.config.set("groundcontrol_public_url", "https://old.example.com");
  m.config.set("groundcontrol_publish_mode", "caddy");
  const result = await publishWithCloudflare({ hostname: "app.example.com" });
  expect(result.canonicalUrl).toBe("https://old.example.com");
  expect(result.aliases).toEqual(["https://app.example.com"]);
  expect(m.exec.mock.calls.some(([c]) => c.includes("rm -f /etc/caddy/sites/groundcontrol.caddy"))).toBe(false);
  expect(m.config.get("groundcontrol_public_url")).toBe("https://old.example.com");
});
it("adds Caddy alias without overwriting canonical route or issuer", async () => {
  m.config.set("groundcontrol_canonical_url", "https://203.0.113.1.sslip.io");
  m.config.set("groundcontrol_public_url", "https://203.0.113.1.sslip.io");
  m.config.set("groundcontrol_publish_mode", "caddy");
  const result = await publishWithCaddy({ hostname: "app.example.com", purpose: "custom_domain" });
  expect(result.canonicalUrl).toBe("https://203.0.113.1.sslip.io");
  expect(result.aliasUrl).toBe("https://app.example.com");
  expect(m.events.some(c => c.includes("cat > /etc/caddy/sites/groundcontrol.caddy"))).toBe(false);
  expect(m.events.some(c => c.includes("docker rm -f"))).toBe(false);
});
it("rejects overlapping changes within the installer web process", async () => {
  let release!:()=>void;
  const pending = new Promise<void>(resolve=>{release=resolve;});
  m.resolve.mockImplementationOnce(async()=>{await pending;return ["203.0.113.1"];});
  const first = publishWithCaddy({hostname:"app.example.com"});
  await expect(publishWithCaddy({hostname:"other.example.com"})).rejects.toMatchObject({status:409});
  release(); await first;
});
it("preserves permanent canonical and old routes when alias verification fails", async () => {
  m.config.set("groundcontrol_canonical_url", "https://old.example.com");
  m.config.set("groundcontrol_public_url", "https://old.example.com");
  m.config.set("groundcontrol_publish_mode", "caddy");
  const original = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url:string, init?:RequestInit) => url.includes("app.example.com/api/auth/claim") ? new Response(JSON.stringify({instanceId:"wrong",claimed:true})) : original(url,init)));
  await expect(publishWithCaddy({hostname:"app.example.com"})).rejects.toMatchObject({status:502});
  expect(m.config.get("groundcontrol_public_url")).toBe("https://old.example.com");
  expect(m.config.get("groundcontrol_public_aliases")).toBeUndefined();
  const rollback = m.events.find(c => c.includes("rm -f '/etc/caddy/groundcontrol-sites/groundcontrol-"));
  expect(rollback).toBeTruthy();
  expect(rollback).not.toContain("Caddyfile.gc-before-publish");
});

function expectNoCaddyMutation() {
  expect(m.exec.mock.calls.some(([command]) => /GC_CADDY|apt-get|apk add|dnf install|yum install/.test(command))).toBe(false);
  expectPreserved();
}
it.each([["198.51.100.9"], ["203.0.113.1", "198.51.100.9"]])("rejects conflicting A answers %j before touching Caddy", async (...addresses) => {
  m.resolve.mockResolvedValue(addresses);
  await expect(publishWithCaddy({hostname: "app.example.com"})).rejects.toMatchObject({code: "DNS_REQUIRED"});
  expectNoCaddyMutation();
});
it("rejects stale AAAA records and preserves the existing route", async () => {
  m.resolve6.mockResolvedValue(["2001:db8::99"]);
  await expect(publishWithCaddy({hostname: "app.example.com"})).rejects.toThrow("not confirmed on this server");
  expectNoCaddyMutation();
});
it("accepts matching dual-stack with normalized IPv6 notation", async () => {
  m.resolve6.mockResolvedValue(["2001:0DB8:0000:0000:0000:0000:0000:0001"]);
  const original = m.exec.getMockImplementation()!;
  m.exec.mockImplementation((command: string) => command.includes("ip -6 -o address")
    ? Promise.resolve({code: 0, stdout: "2: eth0 inet6 2001:db8::1/64 scope global dynamic\n", stderr: ""})
    : original(command));
  expect((await publishWithCaddy({hostname: "app.example.com"})).verification.ok).toBe(true);
  expect(m.exec).toHaveBeenCalledWith(expect.stringContaining("ip -6 -o address"), {requireHost: true, timeout: 10000});
});
it.each(["A", "AAAA"])("does not prescribe DNS edits when %s lookup fails", async (type) => {
  (type === "A" ? m.resolve : m.resolve6).mockRejectedValue(Object.assign(new Error("resolver error"), {code: "ESERVFAIL"}));
  await expect(publishWithCaddy({hostname: "app.example.com"})).rejects.toThrow("Do not change records based on this failed check");
  expectNoCaddyMutation();
});
it("accepts absent AAAA records without inspecting or installing host IPv6 tools", async () => {
  m.resolve6.mockRejectedValue(Object.assign(new Error("no records"), {code: "ENODATA"}));
  expect((await publishWithCaddy({hostname: "app.example.com"})).verification.ok).toBe(true);
  expect(m.exec.mock.calls.some(([command]) => command.includes("ip -6 -o address"))).toBe(false);
});
it("reports missing ip command rather than treating IPv6 as absent", async () => {
  m.resolve6.mockResolvedValue(["2001:db8::1"]);
  const original = m.exec.getMockImplementation()!;
  m.exec.mockImplementation((command: string) => command.includes("ip -6 -o address")
    ? Promise.resolve({code: 127, stdout: "", stderr: "ip not found"}) : original(command));
  await expect(publishWithCaddy({hostname: "app.example.com"})).rejects.toThrow("ip command is available");
  expectNoCaddyMutation();
});

it("bounds an unresponsive DNS lookup without changing existing access", async () => {
  vi.useFakeTimers();
  try {
    m.resolve.mockReturnValue(new Promise(() => {}));
    const result = publishWithCaddy({hostname: "app.example.com"});
    const rejected = expect(result).rejects.toThrow("DNS lookup is unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expectNoCaddyMutation();
  } finally { vi.useRealTimers(); }
});

it("rejects mixed valid/stale AAAA rather than accepting one matching address", async () => {
  m.resolve6.mockResolvedValue(["2001:db8::1", "2001:db8::2"]);
  const original = m.exec.getMockImplementation()!;
  m.exec.mockImplementation((command: string) => command.includes("ip -6 -o address")
    ? Promise.resolve({code: 0, stdout: "2: eth0 inet6 2001:db8::1/64 scope global\n2: eth0 inet6 2001:db8::2/64 scope global tentative\n", stderr: ""})
    : original(command));
  await expect(publishWithCaddy({hostname: "app.example.com"})).rejects.toThrow("2001:db8::2");
  expectNoCaddyMutation();
});

it("rolls back only candidate route on alias database failure", async () => {
  m.config.set("groundcontrol_canonical_url", "https://old.example.com");
  m.config.set("groundcontrol_public_url", "https://old.example.com");
  m.config.set("groundcontrol_publish_mode", "caddy");
  m.failConfig = "groundcontrol_public_aliases";
  await expect(publishWithCaddy({hostname:"app.example.com"})).rejects.toThrow("config write failed");
  expect(m.config.get("groundcontrol_public_url")).toBe("https://old.example.com");
  expect(m.config.get("groundcontrol_public_aliases")).toBeUndefined();
  expect(m.config.has("groundcontrol_publish_lock")).toBe(false);
  expect(m.events.some(c => c.includes("rm -f '/etc/caddy/groundcontrol-sites/groundcontrol-"))).toBe(true);
});
it.each([keepInstancePrivate, publishQuickTunnel])("refuses implicit downgrade of canonical public access", async (change) => {
  m.config.set("groundcontrol_canonical_url", "https://old.example.com");
  await expect(change()).rejects.toMatchObject({status:409});
  expect(m.exec).not.toHaveBeenCalled();
});
it("scoped Caddy shell rollback preserves prior routes and unrelated global config", async () => {
  const original = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url:string, init?:RequestInit) => url.includes("app.example.com/api/auth/claim") ? new Response(JSON.stringify({instanceId:"wrong",claimed:true})) : original(url,init)));
  await expect(publishWithCaddy({hostname:"app.example.com"})).rejects.toMatchObject({status:502});
  const prepare = m.events.find(c => c.includes("GC_CADDY"))!;
  const rollback = m.events.find(c => c.includes("rm -f '/etc/caddy/groundcontrol-sites/groundcontrol-"))!;
  const root = mkdtempSync(join(tmpdir(), "gc-additive-caddy-"));
  const config = join(root,"caddy"); const bin = join(root,"bin");
  try {
    mkdirSync(join(config,"sites"),{recursive:true}); mkdirSync(bin);
    writeFileSync(join(config,"Caddyfile"),"# operator configuration\n");
    writeFileSync(join(config,"sites/groundcontrol.caddy"),"old.example.com { respond old }\n");
    writeFileSync(join(config,"sites/dormant.caddy"),"unrelated.example.com { respond not-public }\n");
    writeFileSync(join(bin,"caddy"),"#!/bin/sh\nexit 0\n",{mode:0o755});
    const run = (command:string) => execFileSync("/bin/sh",["-c",command.replaceAll("/etc/caddy",config)],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`}});
    run(prepare);
    expect(readFileSync(join(config,"Caddyfile"),"utf8")).toBe("# operator configuration\n\nimport " + config + "/groundcontrol-sites/*\n");
    expect(readFileSync(join(config,"Caddyfile"),"utf8")).not.toContain(config + "/sites/*");
    expect(readFileSync(join(config,"sites/dormant.caddy"),"utf8")).toContain("not-public");
    expect(()=>run(prepare)).toThrow(); // no overwrite of an existing candidate
    run(rollback);
    expect(existsSync(join(config,"sites/groundcontrol.caddy"))).toBe(true);
    expect(readFileSync(join(config,"sites/groundcontrol.caddy"),"utf8")).toContain("old.example.com");
    expect(readFileSync(join(config,"Caddyfile"),"utf8")).toContain("# operator configuration");
  } finally {rmSync(root,{recursive:true,force:true});}
});
it("bootstraps a private installation using same-instance TLS before setting its first issuer", async () => {
  m.config.delete("groundcontrol_public_url");
  m.config.set("groundcontrol_publish_mode", "private");
  const original = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url:string, init?:RequestInit) => url.startsWith("https:") && url.includes("/.well-known/") && !m.config.get("groundcontrol_canonical_url") ? new Response("{}",{status:503}) : original(url,init)));
  const result = await publishWithCaddy({hostname:"app.example.com"});
  expect(result.canonicalUrl).toBe("https://app.example.com");
  expect(result.verification.checks.publicHttps.status).toBe("ready");
  expect(result.verification.publicUrl).toBe(result.canonicalUrl);
});
it("never bootstraps a private installation from another instance's TLS endpoint", async () => {
  m.config.delete("groundcontrol_public_url");
  m.config.set("groundcontrol_publish_mode", "private");
  const original = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url:string, init?:RequestInit) => url.startsWith("https:") && url.endsWith("/api/auth/claim") ? new Response(JSON.stringify({instanceId:"wrong",claimed:true})) : original(url,init)));
  await expect(publishWithCaddy({hostname:"app.example.com"})).rejects.toMatchObject({status:502});
  expect(m.config.get("groundcontrol_canonical_url")).toBeUndefined();
});
it("persists canonical evidence separately from alias verification", async () => {
  m.config.set("groundcontrol_canonical_url", "https://old.example.com");
  m.config.set("groundcontrol_public_url", "https://old.example.com");
  m.config.set("groundcontrol_publish_mode", "caddy");
  const result = await publishWithCaddy({hostname:"app.example.com"});
  expect(result.verification.publicUrl).toBe("https://old.example.com");
  expect(result.aliasVerification.publicUrl).toBe("https://app.example.com");
  expect(JSON.parse(m.config.get("groundcontrol_publish_evidence")!).publicUrl).toBe("https://old.example.com");
});
it.each([publishWithCaddy, publishWithCloudflare])("restores bootstrap identity if final canonical metadata verification fails", async (publish) => {
  const original = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url:string, init?:RequestInit) => url.startsWith("https:") && url.endsWith("/.well-known/oauth-authorization-server") && m.config.get("groundcontrol_canonical_url") ? new Response(JSON.stringify({issuer:"https://wrong.example.com"})) : original(url,init)));
  await expect(publish({hostname:"app.example.com"})).rejects.toThrow("Previous canonical identity and evidence were restored");
  expect(m.config.get("groundcontrol_canonical_url")).toBe("");
  expectPreserved();
});

it.each([
  {code:127,stdout:"",stderr:"ss unavailable"},
  {code:0,stdout:'LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=123,fd=6))',stderr:""},
  {code:0,stdout:'LISTEN 0 511 0.0.0.0:80 0.0.0.0:*',stderr:""},
])("blocks custom domain before installing Caddy when ports cannot be safely used", async (result) => {
  const original=m.exec.getMockImplementation()!;
  m.exec.mockImplementation((command:string)=>command.includes("ss -H -ltnp")?Promise.resolve(result):original(command));
  await expect(publishWithCaddy({hostname:"app.example.com",purpose:"custom_domain"})).rejects.toMatchObject({status:409});
  expect(m.events.some(c=>c.includes("caddy version")||c.includes("apt-get")||c.includes("GC_CADDY"))).toBe(false);
  expectPreserved();
});

it("keeps bootstrap fallback visible after refresh and subsequent custom aliases", async () => {
  await publishWithCaddy({hostname:"app.example.com"});
  expect((await instancePublishStatus()).retainedBootstrapUrl).toBe("https://prior.trycloudflare.com");
  await publishWithCaddy({hostname:"other.example.com",purpose:"custom_domain"});
  expect((await instancePublishStatus()).retainedBootstrapUrl).toBe("https://prior.trycloudflare.com");
  expect(m.events.some(c=>c.includes("docker rm -f 'groundcontrol-quick-tunnel'"))).toBe(false);
});

it("repeating a saved Cloudflare hostname only verifies without provider or connector mutation", async () => {
  m.config.set("groundcontrol_public_url","https://app.example.com");
  m.config.set("groundcontrol_publish_mode","cloudflare");
  const result = await publishWithCloudflare({hostname:"app.example.com"});
  expect(result.verification.checks.publicHttps.status).toBe("ready");
  expect(m.tunnel).not.toHaveBeenCalled(); expect(m.configure).not.toHaveBeenCalled(); expect(m.dns).not.toHaveBeenCalled();
  expect(m.exec.mock.calls.some(([c])=>c.includes("docker run")||c.includes("docker rm"))).toBe(false);
});
it("reuses the recorded running named connector for a new alias", async () => {
  m.row.mockResolvedValue({tunnelId:"prior-tunnel",tunnelSecret:"test",connectorId:"old-connector",domains:"old.example.com"});
  await publishWithCloudflare({hostname:"app.example.com"});
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({update:expect.objectContaining({connectorId:"old-connector"})}));
  expect(m.exec.mock.calls.some(([c])=>c.includes("docker run")||c.includes("docker rm"))).toBe(false);
});
it("does not create an untracked replacement for an unavailable recorded connector", async () => {
  m.row.mockResolvedValue({tunnelId:"prior-tunnel",tunnelSecret:"test",connectorId:"old-connector",domains:"old.example.com"});
  const original=m.exec.getMockImplementation()!;
  m.exec.mockImplementation((command:string)=>command.includes(".State.Running")?Promise.resolve({code:0,stdout:"false",stderr:""}):original(command));
  await expect(publishWithCloudflare({hostname:"app.example.com"})).rejects.toMatchObject({status:409});
  expect(m.configure).not.toHaveBeenCalled(); expect(m.tunnel).not.toHaveBeenCalled(); expect(m.dns).not.toHaveBeenCalled();
  expect(m.exec.mock.calls.some(([c])=>c.includes("docker run")||c.includes("docker rm"))).toBe(false);
});
