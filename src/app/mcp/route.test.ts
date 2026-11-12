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
import { OAuthBearerError } from "@/lib/oauth";

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
      version: "0.1.0",
    });
    expect(data.result._meta["io.groundcontrol/toolsetRevision"]).toBe("2026-11-12.help.1");
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

  it.each(["2025-11-25", "2026-07-28"])(
    "challenges unauthenticated %s tool calls at HTTP and tool level without executing them",
    async (version) => {
      mock.authenticateAccessToken.mockRejectedValue(new OAuthBearerError("Missing Bearer token", 401));
      const response = await POST(request({
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "deployment.list", arguments: {} },
      }, { "MCP-Protocol-Version": version }));
      const data = await response.json();
      expect(response.status).toBe(401);
      const challenge = response.headers.get("WWW-Authenticate");
      expect(challenge).toContain('error="invalid_token"');
      expect(challenge).toContain('resource_metadata="https://groundcontrol.example/.well-known/oauth-protected-resource"');
      expect(data.result.isError).toBe(true);
      expect(data.result._meta["mcp/www_authenticate"]).toEqual([challenge]);
      expect(mock.executeAgentTool).not.toHaveBeenCalled();
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  );

  it("returns 403 with an exact scope challenge without weakening authorization", async () => {
    const context = { resources: [1] };
    mock.authenticateAccessToken.mockResolvedValue(context);
    mock.executeAgentTool.mockRejectedValue(new OAuthBearerError("Missing required scope: deployment:redeploy", 403, "deployment:redeploy"));
    const response = await POST(request({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "deployment.restart", arguments: { deployment: "1", idempotencyKey: "test-key" } },
    }));
    const data = await response.json();
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="deployment:redeploy"');
    expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
    expect(data.result._meta["mcp/www_authenticate"]).toEqual([response.headers.get("WWW-Authenticate")]);
    expect(mock.executeAgentTool).toHaveBeenCalledOnce();
    expect(mock.executeAgentTool).toHaveBeenCalledWith(context, "deployment.restart", { deployment: "1", idempotencyKey: "test-key" });
  });

  it("accepts a freshly authenticated retry and returns actual tool evidence", async () => {
    const context = { resources: [1] };
    mock.authenticateAccessToken
      .mockRejectedValueOnce(new OAuthBearerError("Expired access token", 401))
      .mockResolvedValueOnce(context);
    mock.executeAgentTool.mockResolvedValue({ deployments: [{ id: 1 }] });
    const call = { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "deployment.list", arguments: {} } };
    expect((await POST(request(call))).status).toBe(401);
    const retried = await POST(request(call, { Authorization: "Bearer test-fresh-token" }));
    expect(retried.status).toBe(200);
    expect((await retried.json()).result).toMatchObject({ isError: false, structuredContent: { deployments: [{ id: 1 }] } });
    expect(mock.executeAgentTool).toHaveBeenCalledOnce();
  });

  it("keeps ordinary tool failures distinct from authentication challenges", async () => {
    mock.authenticateAccessToken.mockResolvedValue({ resources: [1] });
    mock.executeAgentTool.mockRejectedValue(new Error("Runtime operation is unsupported"));
    const response = await POST(request({
      jsonrpc: "2.0", id: 6, method: "tools/call",
      params: { name: "deployment.restart", arguments: { deployment: "1" } },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
    expect((await response.json()).result).toMatchObject({ isError: true, content: [{ type: "text", text: "Runtime operation is unsupported" }] });
    expect(mock.executeAgentTool).toHaveBeenCalledOnce();
  });
});

for (const method of ["initialize", "server/discover"]) {
  it(`communicates current workload help through ${method} without claiming unreleased local parity`, async () => {
    const response = await POST(request({ jsonrpc: "2.0", id: 1, method, params: {} }));
    const { result } = await response.json();
    for (const text of ["Preserve working Compose", "one ready image", "do not claim local Dockerfile", "offer help installing", "never request secret values", "not an available MCP creation tool", "runtime evidence"]) expect(result.instructions).toContain(text);
  });
}
