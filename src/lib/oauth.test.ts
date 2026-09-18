// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isAllowedRedirectUri,
  normalizeScope,
  pkceChallenge,
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
});
