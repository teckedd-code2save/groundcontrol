// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  authenticateAccessToken: vi.fn(),
  executeAgentTool: vi.fn(),
  tools: vi.fn(),
}));

vi.mock("@/lib/oauth", () => ({
  MCP_PROTOCOL_VERSION: "2026-07-28",
  authenticateAccessToken: mock.authenticateAccessToken,
  OAuthBearerError: class OAuthBearerError extends Error {
    constructor(message: string, public status: number, public requiredScope?: string) {
      super(message);
    }
  },
  protectedResourceMetadataUrl: () => "https://groundcontrol.example/.well-known/oauth-protected-resource",
  requestOrigin: () => "https://groundcontrol.example",
}));

vi.mock("@/lib/mcp-agent", () => ({
  executeAgentTool: mock.executeAgentTool,
  toolDefinitionsForScopes: mock.tools,
}));

import { POST } from "./route";

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest("https://groundcontrol.example/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mock.authenticateAccessToken.mockReset();
  mock.executeAgentTool.mockReset();
  mock.tools.mockReset();
  mock.tools.mockReturnValue([
    {
      name: "deployment.list",
      title: "List deployments",
      description: "List approved deployments.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: { deployments: { type: "array", items: { type: "object" } } },
        required: ["deployments"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      securitySchemes: [{ type: "oauth2", scopes: ["deployment:read"] }],
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: ["deployment:read"] }],
      },
    },
  ]);
});

describe("GroundControl MCP transport", () => {
  it("lets ChatGPT discover tool actions before bearer authentication", async () => {
    const response = await POST(request({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result.tools[0]).toMatchObject({
      name: "deployment.list",
      outputSchema: { type: "object" },
      securitySchemes: [{ type: "oauth2", scopes: ["deployment:read"] }],
    });
    expect(mock.authenticateAccessToken).not.toHaveBeenCalled();
    expect(mock.tools).toHaveBeenCalledWith();
  });

  it("returns the 2026 discover shape when ChatGPT scans using the modern protocol", async () => {
    const response = await POST(request({
      jsonrpc: "2.0",
      id: "discover",
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        },
      },
    }, {
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "server/discover",
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result.supportedVersions).toContain("2026-07-28");
    expect(data.result.capabilities.tools).toEqual({ listChanged: false });
    expect(data.result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({
      name: "GroundControl",
    });
    expect(response.headers.get("MCP-Protocol-Version")).toBe("2026-07-28");
    expect(mock.authenticateAccessToken).not.toHaveBeenCalled();
  });

  it("keeps legacy initialize compatible without forcing a modern response header", async () => {
    const response = await POST(request({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "ChatGPT", version: "test" },
      },
    }));
    const data = await response.json();

    expect(data.result.protocolVersion).toBe("2025-11-25");
    expect(data.result.serverInfo.name).toBe("GroundControl");
    expect(response.headers.get("MCP-Protocol-Version")).toBeNull();
    expect(mock.authenticateAccessToken).not.toHaveBeenCalled();
  });
});
