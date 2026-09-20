// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
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
