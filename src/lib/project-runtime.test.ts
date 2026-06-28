// src/lib/project-runtime.test.ts
import { describe, it, expect } from "vitest";

describe("buildProjectRuntime", () => {
  it("returns a valid ProjectRuntime with required fields", async () => {
    const { buildProjectRuntime } = await import("./project-runtime");
    const rt = await buildProjectRuntime();
    expect(rt).toHaveProperty("projects");
    expect(rt).toHaveProperty("unclaimedContainers");
    expect(rt).toHaveProperty("unclaimedSites");
    expect(rt).toHaveProperty("summary");
    expect(Array.isArray(rt.projects)).toBe(true);
    expect(Array.isArray(rt.unclaimedContainers)).toBe(true);
    expect(typeof rt.summary).toBe("string");
  });

  it("each project has expected fields", async () => {
    const { buildProjectRuntime } = await import("./project-runtime");
    const rt = await buildProjectRuntime();
    for (const proj of rt.projects) {
      expect(proj).toHaveProperty("slug");
      expect(proj).toHaveProperty("name");
      expect(proj).toHaveProperty("path");
      expect(proj).toHaveProperty("composePath");
      expect(proj).toHaveProperty("services");
      expect(proj).toHaveProperty("extraContainers");
      expect(proj).toHaveProperty("health");
      expect(["healthy", "warning", "critical"]).toContain(proj.health);
    }
  });
});
