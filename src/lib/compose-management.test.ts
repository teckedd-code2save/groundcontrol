import { describe, expect, it } from "vitest";
import {
  assertDockerImageReference,
  composeServiceImages,
  imageReferenceMatches,
  readManagedImageOverrides,
  updateManagedImageOverride,
} from "./compose-management";

describe("managed Compose image configuration", () => {
  it("reads resolved service images", () => {
    expect(composeServiceImages(`services:\n  api:\n    image: ghcr.io/acme/api:main\n  db:\n    image: postgres:16\n`)).toEqual({
      api: "ghcr.io/acme/api:main",
      db: "postgres:16",
    });
  });

  it("adds, updates, and removes one service without losing other overrides", () => {
    const first = updateManagedImageOverride("", "api", "ghcr.io/acme/api:abc123");
    const second = updateManagedImageOverride(first.content, "web", "ghcr.io/acme/web:abc123");
    const updated = updateManagedImageOverride(second.content, "api", "ghcr.io/acme/api:def456");
    expect(readManagedImageOverrides(updated.content)).toEqual({
      api: "ghcr.io/acme/api:def456",
      web: "ghcr.io/acme/web:abc123",
    });
    expect(updateManagedImageOverride(updated.content, "api", "").images).toEqual({
      web: "ghcr.io/acme/web:abc123",
    });
  });

  it("rejects shell/YAML injection and incomplete digests", () => {
    expect(() => assertDockerImageReference("ghcr.io/acme/api:latest; rm -rf /" )).toThrow();
    expect(() => assertDockerImageReference("ghcr.io/acme/api@sha256:abc")).toThrow();
  });

  it("treats Docker Hub's explicit library prefix as equivalent", () => {
    expect(imageReferenceMatches("postgres:16-alpine", "docker.io/library/postgres:16-alpine")).toBe(true);
  });
});
