// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { appConfig: { findMany: async () => [
  { key: "github_registry_username", value: "acme" },
  { key: "github_registry_token", value: "test-registry-credential" },
] } } }));
vi.mock("@/lib/crypto", () => ({ decryptMaybe: (v: string) => v, encrypt: (v: string) => v }));
import { loadGithubRegistryPublishCredential } from "./github-registry";
afterEach(() => vi.unstubAllGlobals());
describe("registry publish preflight", () => {
  it.each(["read:packages", "", "repo, read:packages"])("rejects %s before paying for a sandbox", async scopes => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "x-oauth-scopes": scopes } })));
    await expect(loadGithubRegistryPublishCredential()).rejects.toThrow("write:packages");
  });
  it("accepts a valid package writer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "x-oauth-scopes": "read:packages, write:packages" } })));
    const credential = await loadGithubRegistryPublishCredential();
    expect(credential.username).toBe("acme");
  });
  it("does not return remote bodies or credentials in authentication errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("test-registry-credential", { status: 401 })));
    await expect(loadGithubRegistryPublishCredential()).rejects.not.toThrow("test-registry-credential");
  });
});
