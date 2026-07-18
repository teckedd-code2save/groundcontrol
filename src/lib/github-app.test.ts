import { createHmac, generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildGithubAppManifest,
  createGithubAppJwt,
  createGithubManifestState,
  normalizeGithubPublicUrl,
  normalizeGithubRepositoryUrl,
  verifyGithubManifestState,
  verifyGithubWebhookSignature,
} from "./github-app";

describe("GitHub App security and manifest helpers", () => {
  beforeEach(() => { process.env.JWT_SECRET = "github-app-test-secret"; });

  it("requires public HTTPS outside local development", () => {
    expect(normalizeGithubPublicUrl("https://gc.example.com/")).toBe("https://gc.example.com");
    expect(normalizeGithubPublicUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(() => normalizeGithubPublicUrl("http://gc.example.com")).toThrow(/HTTPS/);
  });

  it("builds a least-privilege manifest for the instance", () => {
    const manifest = buildGithubAppManifest("https://gc.example.com", "abc123");
    expect(manifest.name).toBe("GroundControl gc-example-com abc123");
    expect(manifest.hook_attributes.url).toBe("https://gc.example.com/api/github/webhooks");
    expect(manifest.default_permissions.contents).toBe("read");
    expect(manifest.default_permissions.pull_requests).toBe("write");
    expect(manifest.default_events).toContain("workflow_run");
  });

  it("signs and validates a short-lived manifest state", () => {
    const state = createGithubManifestState({ userId: 7, publicUrl: "https://gc.example.com" });
    expect(verifyGithubManifestState(state)).toMatchObject({ userId: 7, publicUrl: "https://gc.example.com" });
  });

  it("creates a verifiable RS256 GitHub App JWT", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = createGithubAppJwt("12345", privateKey.export({ type: "pkcs8", format: "pem" }).toString(), 1_700_000_000);
    const decoded = jwt.verify(token, publicKey.export({ type: "spki", format: "pem" }).toString(), {
      algorithms: ["RS256"],
      clockTimestamp: 1_700_000_010,
    }) as jwt.JwtPayload;
    expect(decoded.iss).toBe("12345");
  });

  it("verifies webhook signatures without accepting malformed values", () => {
    const body = JSON.stringify({ action: "created" });
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyGithubWebhookSignature(body, signature, "secret")).toBe(true);
    expect(verifyGithubWebhookSignature(body, `${signature}0`, "secret")).toBe(false);
    expect(verifyGithubWebhookSignature(body, null, "secret")).toBe(false);
  });

  it("normalizes HTTPS and SSH repository identities", () => {
    expect(normalizeGithubRepositoryUrl("https://github.com/Acme/App.git")).toBe("acme/app");
    expect(normalizeGithubRepositoryUrl("git@github.com:Acme/App.git")).toBe("acme/app");
    expect(normalizeGithubRepositoryUrl("https://gitlab.com/acme/app")).toBe("");
  });
});
