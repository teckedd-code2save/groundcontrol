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
    expect(names).toContain("deployment.config.check");
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

  it("publishes a complete public action catalog for ChatGPT discovery", () => {
    const tools = toolDefinitionsForScopes();
    expect(tools.map((tool) => tool.name)).toEqual([
      "deployment.list",
      "deployment.inspect",
      "deployment.logs",
      "deployment.health",
      "deployment.config.check",
      "deployment.redeploy",
      "operation.get",
    ]);

    const configTool = tools.find((tool) => tool.name === "deployment.config.check");
    expect(configTool?.securitySchemes[0].scopes).toEqual(["deployment:read"]);
    expect(JSON.stringify(configTool?.outputSchema)).not.toContain('"value"');

    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
      expect(tool.securitySchemes).toHaveLength(1);
      expect(tool.securitySchemes[0]).toMatchObject({ type: "oauth2" });
      expect(tool.securitySchemes[0].scopes.length).toBeGreaterThan(0);
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
    }
  });
});
