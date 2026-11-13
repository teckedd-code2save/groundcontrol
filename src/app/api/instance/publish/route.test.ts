// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), desktop: vi.fn(), inspect: vi.fn(), caddy: vi.fn(), server: vi.fn(), status: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: m.auth }));
vi.mock("@/lib/runtime", () => ({ isDesktopMode: m.desktop }));
vi.mock("@/lib/audit", () => ({ createAuditLog: m.audit }));
vi.mock("@/lib/generated-instance-address", () => ({ inspectGeneratedInstanceAddress: m.inspect }));
vi.mock("@/lib/instance-publish", () => ({ instancePublishStatus: m.status, publishWithCaddy: m.caddy, publishServerAddress: m.server, keepInstancePrivate: vi.fn(), publishQuickTunnel: vi.fn(), publishWithCloudflare: vi.fn(), verifyGroundControlInstance: vi.fn() }));
import { GET, POST } from "./route";
const plan = { hostname: "203.0.113.1.sslip.io", publicUrl: "https://203.0.113.1.sslip.io", source: "sslip", publicIpv4: "203.0.113.1", stability: "IP-bound", canPublish: true, needs: [] };
const request = (body: unknown) => new NextRequest("https://gc.example/api/instance/publish", {method: "POST", body: JSON.stringify(body), headers: {"Content-Type": "application/json"}});
beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllEnvs();
  m.auth.mockReturnValue({id: 1, role: "admin"}); m.desktop.mockReturnValue(false);
  m.status.mockResolvedValue({mode: "quick_tunnel", publicUrl: "https://existing.example"});
  m.inspect.mockResolvedValue(plan); m.server.mockResolvedValue({mode: "caddy", publicUrl: plan.publicUrl, verification: {ok: true}}); m.caddy.mockResolvedValue({mode: "caddy", publicUrl: plan.publicUrl, verification: {ok: true}});
});
it("ordinary status is read-only without generated-address probes", async () => {
  expect((await GET(new NextRequest("https://gc.example/api/instance/publish"))).status).toBe(200);
  expect(m.inspect).not.toHaveBeenCalled(); expect(m.caddy).not.toHaveBeenCalled();
});
it("preview passes only host configuration and never configures Caddy", async () => {
  vi.stubEnv("GC_PROVIDER_HOSTNAME", "verified.provider.example");
  const result = await GET(new NextRequest("https://gc.example/api/instance/publish?generatedAddress=1&providerHostname=untrusted.example"));
  expect((await result.json()).generatedAddress).toEqual(plan);
  expect(m.inspect).toHaveBeenCalledWith({providerHostname: "verified.provider.example"}); expect(m.caddy).not.toHaveBeenCalled();
});
it("recomputes generated hostname rather than accepting browser override", async () => {
  const result = await POST(request({action: "server_address", hostname: "untrusted.example", providerHostname: "untrusted.example"}));
  expect(result.status).toBe(200); expect(m.inspect).toHaveBeenCalledOnce();
  expect(m.server).toHaveBeenCalledWith(); expect(m.caddy).not.toHaveBeenCalled();
  expect(m.audit).toHaveBeenCalledOnce();
});
it("blocks unsafe proxy prerequisites before any configuration", async () => {
  m.inspect.mockResolvedValue({...plan, canPublish: false, needs: [{code: "PROXY_CONFLICT", blocking: true, detail: "Existing proxy owns port443"}]});
  const result = await POST(request({action: "server_address"}));
  expect(result.status).toBe(409); expect((await result.json()).code).toBe("SERVER_ADDRESS_PREREQUISITES");
  expect(m.caddy).not.toHaveBeenCalled(); expect(m.server).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
});
it("does not expose server setup in desktop mode", async () => {
  m.desktop.mockReturnValue(true);
  const preview = await GET(new NextRequest("https://gc.example/api/instance/publish?generatedAddress=1"));
  expect((await preview.json()).generatedAddress).toBeUndefined();
  expect((await POST(request({action: "server_address"}))).status).toBe(400);
  expect(m.inspect).not.toHaveBeenCalled(); expect(m.caddy).not.toHaveBeenCalled();
});
it("requires admin before discovery or publication", async () => {
  m.auth.mockReturnValue({id: 2, role: "member"});
  expect((await GET(new NextRequest("https://gc.example/api/instance/publish?generatedAddress=1"))).status).toBe(403);
  expect((await POST(request({action: "server_address"}))).status).toBe(403);
  expect(m.inspect).not.toHaveBeenCalled(); expect(m.caddy).not.toHaveBeenCalled();
});
it("marks a supplied domain as an optional custom alias", async () => {
  expect((await POST(request({action: "caddy", hostname: "my.example"}))).status).toBe(200);
  expect(m.caddy).toHaveBeenCalledWith({hostname: "my.example", purpose: "custom_domain"});
});
