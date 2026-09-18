// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toolDefinitionsForScopes } from "./mcp-agent";

describe("GroundControl MCP tool catalog", () => {
  it("does not expose write operations to a read-only grant", () => {
    const names = toolDefinitionsForScopes(new Set(["deployment:read", "deployment:health", "operation:read"]))
      .map((tool) => tool.name);
    expect(names).toContain("deployment.list");
    expect(names).toContain("deployment.inspect");
    expect(names).toContain("deployment.health");
    expect(names).toContain("operation.get");
    expect(names).not.toContain("deployment.redeploy");
  });

  it("exposes redeploy only when explicitly granted and never exposes a shell tool", () => {
    const names = toolDefinitionsForScopes(new Set([
      "deployment:read",
      "deployment:logs",
      "deployment:health",
      "deployment:redeploy",
      "operation:read",
    ])).map((tool) => tool.name);
    expect(names).toContain("deployment.redeploy");
    expect(names.some((name) => /shell|exec|terminal/i.test(name))).toBe(false);
  });
});
