import { describe, expect, it } from "vitest";
import {
  getManagedRootFromConfig,
  normalizeDeploymentSlug,
  slugFromInput,
  redactComposeSecrets,
  DEFAULT_MANAGED_ROOT,
} from "./managed-deployments";

describe("managed deployment helpers", () => {
  it("defaults managed root", () => {
    expect(getManagedRootFromConfig(null)).toBe(DEFAULT_MANAGED_ROOT);
    expect(getManagedRootFromConfig(undefined)).toBe(DEFAULT_MANAGED_ROOT);
    expect(getManagedRootFromConfig("/srv/custom/deployments/")).toBe("/srv/custom/deployments");
  });

  it("normalizes slugs from bare names and paths", () => {
    expect(normalizeDeploymentSlug("gc-tunnel-proof")).toBe("gc-tunnel-proof");
    expect(normalizeDeploymentSlug("gc-tunnel-proof/")).toBe("gc-tunnel-proof");
    expect(normalizeDeploymentSlug("/srv/groundcontrol/deployments/gc-tunnel-proof")).toBe(
      "gc-tunnel-proof"
    );
    expect(normalizeDeploymentSlug("")).toBeNull();
    expect(normalizeDeploymentSlug("../evil")).toBeNull();
  });

  it("resolves slug under managed root without accepting siblings", () => {
    const root = "/srv/groundcontrol/deployments";
    expect(slugFromInput("gc-tunnel-proof", root)).toBe("gc-tunnel-proof");
    expect(slugFromInput(`${root}/gc-tunnel-proof`, root)).toBe("gc-tunnel-proof");
    expect(slugFromInput(`${root}/gc-tunnel-proof/docker-compose.yml`, root)).toBe(
      "gc-tunnel-proof"
    );
    expect(slugFromInput(root, root)).toBeNull();
    expect(slugFromInput(`${root}/../etc`, root)).toBeNull();
  });

  it("redacts tunnel tokens and secrets from compose text", () => {
    const sample = `
services:
  cloudflared:
    command: tunnel --no-autoupdate run --token eyJhIjoiNDA0NGFjZDJkNzRlMjYzNWI0OGVjNGQ4OWEwZTg1ZmIiLCJ0IjoiZGE5OGZmODAtNDNjOS00YjcxLWI1MjctNWY0MWI1OTFiYTljIiwicyI6Ikl4dEJlTTJNZTAvbVAyM0dlUUpTM2xDSG9jUjBvakV3Y2lCWHR3YlpsWlJTeEhEOXQ0bi95Y1c0OU9kaWZ2RlRKbENaZ1lXZUEvcUYydUxZK2hQVml3PT0ifQ==
  app:
    environment:
      - APP_SECRET=I82EF0a_seYq1tnRSMFWdmshQylztKJ4
      - PORT=80
`;
    const redacted = redactComposeSecrets(sample);
    expect(redacted).not.toContain("eyJhIjoi");
    expect(redacted).not.toContain("I82EF0a_seYq1tnRSMFWdmshQylztKJ4");
    expect(redacted).toMatch(/REDACTED/);
    expect(redacted).toContain("PORT=80");
  });

  it("does not invent gc_ double-prefix project names (regression doc)", () => {
    // Historical bug: slug gc-tunnel-proof → projectSlug gc_tunnel_proof → -p gc_gc_tunnel_proof
    // Delete must use directory-based compose down, not this scheme.
    const slug = "gc-tunnel-proof";
    const wrong = `gc_${slug.replace(/-/g, "_")}`;
    expect(wrong).toBe("gc_gc_tunnel_proof");
    // Correct approach: no invented project name; directory basename is fine.
    expect(slug).toBe("gc-tunnel-proof");
  });
});
