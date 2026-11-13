// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { appConfig: { findUnique: mocks.findUnique }, oAuthClient: { findUnique: mocks.client } } }));
import { requestOrigin, validateAuthorizationRequest } from "./oauth";
import { GET as authorizationMetadata } from "@/app/api/oauth/metadata/authorization-server/route";
import { GET as protectedMetadata } from "@/app/api/oauth/metadata/protected-resource/route";

function configure(values: Record<string, string>) {
  mocks.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => values[where.key] === undefined ? null : { value: values[where.key] });
}
const canonical = "https://stable.example.com";
function aliasRequest(path = "/.well-known/oauth-authorization-server") {
  return new NextRequest(`https://custom.example.com${path}`, { headers: { host: "custom.example.com", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http", forwarded: 'host="attacker.example";proto=http' } });
}
beforeEach(() => { vi.clearAllMocks(); configure({}); });

describe("canonical OAuth origin", () => {
  it("prefers canonical configuration over alias URL, legacy setting and forwarded headers", async () => {
    configure({ groundcontrol_canonical_url: `${canonical}/`, groundcontrol_public_url: "https://legacy.example.com" });
    expect(await requestOrigin(aliasRequest())).toBe(canonical);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });
  it("preserves legacy configured origin for older installations", async () => {
    configure({ groundcontrol_public_url: "https://legacy.example.com/" });
    expect(await requestOrigin(aliasRequest())).toBe("https://legacy.example.com");
  });
  it.each(["http://public.example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com/?secret=x", "https://example.com/#x", "https://127.0.0.1", "https://[::1]", "https://localhost"])("fails closed on invalid configured origin %s", async configured => {
    configure({ groundcontrol_canonical_url: configured, groundcontrol_public_url: "https://valid-fallback.example.com" });
    await expect(requestOrigin(aliasRequest())).rejects.toMatchObject({ error: "server_error", status: 503 });
  });
  it.each(["http://127.0.0.1:3003", "http://localhost:3004", "http://[::1]:3003", "https://localhost:3003"])("allows safe private fallback %s without trusting forwarded values", async origin => {
    const req = new NextRequest(`${origin}/mcp`, { headers: { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" } });
    expect(await requestOrigin(req)).toBe(new URL(req.url).origin);
  });
  it("rejects a public Host presented to a local fallback request", async () => {
    const req = new NextRequest("http://localhost:3000/mcp", { headers: { host: "attacker.example" } });
    await expect(requestOrigin(req)).rejects.toMatchObject({ status: 503 });
  });
  it("will not derive an unconfigured issuer from a public request URL", async () => {
    await expect(requestOrigin(aliasRequest())).rejects.toMatchObject({ status: 503 });
  });
  it("does not fall back on database failure", async () => {
    mocks.findUnique.mockRejectedValue(new Error("storage unavailable"));
    await expect(requestOrigin(aliasRequest())).rejects.toThrow("storage unavailable");
  });
  it("serves canonical issuer and resource metadata from an alias without redirects", async () => {
    configure({ groundcontrol_canonical_url: canonical });
    const auth = await authorizationMetadata(aliasRequest());
    expect(auth.status).toBe(200);
    expect(auth.headers.get("location")).toBeNull();
    expect(await auth.json()).toMatchObject({ issuer: canonical, authorization_endpoint: `${canonical}/oauth/authorize`, token_endpoint: `${canonical}/oauth/token` });
    const resource = await protectedMetadata(aliasRequest("/.well-known/oauth-protected-resource"));
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({ resource: `${canonical}/mcp`, authorization_servers: [canonical] });
  });
  it("fails discovery without reflecting spoofed origins or config secrets", async () => {
    configure({ groundcontrol_canonical_url: "https://user:secret@example.com" });
    for (const handler of [authorizationMetadata, protectedMetadata]) {
      const res = await handler(aliasRequest());
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).not.toMatch(/secret|attacker/);
    }
  });
  it("accepts only canonical OAuth resource in new authorization requests", async () => {
    mocks.client.mockResolvedValue({ id: 1, clientId: "client", redirectUris: JSON.stringify(["https://client.example.com/callback"]) });
    const request = { responseType: "code", clientId: "client", redirectUri: "https://client.example.com/callback", scope: "deployment:read", state: "s", resource: `${canonical}/mcp`, codeChallenge: "a".repeat(43), codeChallengeMethod: "S256" };
    expect(await validateAuthorizationRequest(request, canonical, "admin")).toMatchObject({ resource: `${canonical}/mcp` });
    await expect(validateAuthorizationRequest({ ...request, resource: "https://custom.example.com/mcp" }, canonical, "admin")).rejects.toMatchObject({ error: "invalid_target" });
  });
});
