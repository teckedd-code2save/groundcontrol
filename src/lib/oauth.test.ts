// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  supportedOAuthScopes,
  validateScope,
  isAllowedRedirectUri,
  normalizeScope,
  pkceChallenge,
  refreshClientMatches,
  verifyPkce,
} from "./oauth";

describe("agent OAuth primitives", () => {
  it("normalizes scopes deterministically", () => {
    expect(normalizeScope("operation:read deployment:read operation:read")).toBe("deployment:read operation:read");
  });

  it("requires an exact S256 PKCE verifier", () => {
    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const challenge = pkceChallenge(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(verifier + "x", challenge)).toBe(false);
  });

  it("accepts HTTPS and loopback redirects but rejects unsafe redirects", () => {
    expect(isAllowedRedirectUri("https://chat.example.com/oauth/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:43123/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://example.com/callback")).toBe(false);
    expect(isAllowedRedirectUri("https://user:pass@example.com/callback")).toBe(false);
    expect(isAllowedRedirectUri("https://example.com/callback#fragment")).toBe(false);
  });

  it("allows a public PKCE client to refresh without repeating client_id", () => {
    expect(refreshClientMatches({
      expectedClientId: "gc_client_chatgpt",
      tokenEndpointAuthMethod: "none",
      presentedClientId: "",
    })).toBe(true);
  });

  it("still enforces client binding when client_id is supplied", () => {
    expect(refreshClientMatches({
      expectedClientId: "gc_client_chatgpt",
      tokenEndpointAuthMethod: "none",
      presentedClientId: "gc_client_chatgpt",
    })).toBe(true);
    expect(refreshClientMatches({
      expectedClientId: "gc_client_chatgpt",
      tokenEndpointAuthMethod: "none",
      presentedClientId: "another-client",
    })).toBe(false);
  });

  it("does not allow a client that requires token-endpoint authentication to omit identity", () => {
    expect(refreshClientMatches({
      expectedClientId: "confidential-client",
      tokenEndpointAuthMethod: "client_secret_basic",
      presentedClientId: "",
    })).toBe(false);
  });
});


describe("proposal OAuth feature gate", () => {
  it("does not advertise or accept proposal scope while disabled", () => {
    vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS", "0");
    try {
      expect(supportedOAuthScopes()).not.toContain("deployment:propose");
      expect(() => validateScope("deployment:propose", "admin")).toThrow("Unsupported scope");
      expect(validateScope("deployment:read", "admin")).toBe("deployment:read");
    } finally { vi.unstubAllEnvs(); }
  });
  it("requires explicit scope and admin approval while enabled", () => {
    vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS", "1");
    try {
      expect(supportedOAuthScopes()).toContain("deployment:propose");
      expect(validateScope("deployment:propose", "admin")).toBe("deployment:propose");
      expect(() => validateScope("deployment:propose", "viewer")).toThrow("Administrator approval");
      expect(validateScope("", "admin")).not.toContain("deployment:propose");
    } finally { vi.unstubAllEnvs(); }
  });
});

it.each(["0", "1"])("OAuth discovery reflects proposal gate %s", async (enabled) => {
  const { NextRequest } = await import("next/server");
  const { GET: serverMetadata } = await import("../app/api/oauth/metadata/authorization-server/route");
  const { GET: resourceMetadata } = await import("../app/api/oauth/metadata/protected-resource/route");
  vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS", enabled);
  try {
    for (const endpoint of [serverMetadata, resourceMetadata]) {
      const response = await endpoint(new NextRequest("https://gc.example.test/.well-known/oauth-authorization-server"));
      const body = await response.json();
      expect(body.scopes_supported.includes("deployment:propose")).toBe(enabled === "1");
    }
  } finally { vi.unstubAllEnvs(); }
});
