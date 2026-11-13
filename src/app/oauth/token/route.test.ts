// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ config: vi.fn(), refresh: vi.fn(), update: vi.fn(), issue: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { appConfig: { findUnique: mocks.config }, oAuthToken: { findUnique: mocks.refresh, updateMany: mocks.update } } }));
vi.mock("@/lib/oauth", async importActual => ({ ...await importActual<typeof import("@/lib/oauth")>(), issueTokenPair: mocks.issue }));
import { POST } from "./route";
const canonical = "https://stable.example.com";
function request(resource?: string, extra?: string) {
  const params = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "opaque-refresh" });
  if (resource !== undefined) params.append("resource", resource);
  if (extra !== undefined) params.append("resource", extra);
  return new NextRequest("https://alias.example.com/oauth/token", { method: "POST", body: params.toString(), headers: { "x-forwarded-host": "attacker.example", "content-type": "application/x-www-form-urlencoded" } });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockImplementation(async ({ where }: { where: { key: string } }) => where.key === "groundcontrol_canonical_url" ? { value: canonical } : null);
  mocks.refresh.mockResolvedValue({ id: 3, kind: "refresh", revokedAt: null, expiresAt: new Date(Date.now() + 60_000), grantId: 2, scope: "deployment:read", familyId: "family", grant: { revokedAt: null, client: { clientId: "client", tokenEndpointAuthMethod: "none" } } });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.issue.mockResolvedValue({ accessToken: "access", refreshToken: "refresh", expiresIn: 3600, scope: "deployment:read" });
});
describe("canonical token resource", () => {
  it("refreshes a canonical resource through an alias without changing scope or grant", async () => {
    const response = await POST(request(`${canonical}/mcp`));
    expect(response.status).toBe(200);
    expect(mocks.issue).toHaveBeenCalledWith({ grantId: 2, scope: "deployment:read", familyId: "family" });
  });
  it("preserves clients that omit the optional resource parameter", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it.each(["https://alias.example.com/mcp", "https://attacker.example/mcp", ""])("rejects noncanonical resource %s without consuming a token", async resource => {
    const response = await POST(request(resource));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_target" });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects multiple targets even when one is canonical", async () => {
    expect((await POST(request(`${canonical}/mcp`, "https://alias.example.com/mcp"))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("fails closed on origin configuration failure without leaking diagnostics", async () => {
    mocks.config.mockRejectedValue(new Error("secret database details"));
    const response = await POST(request(`${canonical}/mcp`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret database details");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
