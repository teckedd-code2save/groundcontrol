import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAccessToken,
  MCP_PROTOCOL_VERSION,
  OAuthBearerError,
  protectedResourceMetadataUrl,
  requestOrigin,
} from "@/lib/oauth";
import { executeAgentTool, toolDefinitionsForScopes } from "@/lib/mcp-agent";

const LEGACY_PROTOCOL_VERSION = "2025-11-25";
const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const TOOLSET_REVISION = "2026-09-20.1";
const SERVER_INFO = {
  name: "GroundControl",
  title: "GroundControl",
  version: "0.1.0",
};
const SERVER_INSTRUCTIONS =
  "GroundControl exposes scoped infrastructure operations. Inspect state before changing it, use durable operation handles for mutations, and never assume access to workloads outside the OAuth grant.";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function protocolMeta(body: JsonRpcRequest): Record<string, unknown> {
  const params = body.params;
  const meta = params && typeof params._meta === "object" && params._meta
    ? params._meta as Record<string, unknown>
    : {};
  return meta;
}

function isModernRequest(req: NextRequest, body: JsonRpcRequest): boolean {
  const headerVersion = req.headers.get("mcp-protocol-version");
  const metaVersion = protocolMeta(body)["io.modelcontextprotocol/protocolVersion"];
  return headerVersion === MCP_PROTOCOL_VERSION || metaVersion === MCP_PROTOCOL_VERSION;
}

function responseHeaders(modern: boolean, extra?: Record<string, string>) {
  return {
    "Cache-Control": "no-store",
    ...(modern ? { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } : {}),
    ...extra,
  };
}

function addServerMeta(result: unknown, modern: boolean): unknown {
  if (!modern || !result || typeof result !== "object" || Array.isArray(result)) return result;
  const value = result as Record<string, unknown>;
  const existingMeta = value._meta && typeof value._meta === "object"
    ? value._meta as Record<string, unknown>
    : {};
  return {
    ...value,
    _meta: {
      ...existingMeta,
      "io.modelcontextprotocol/serverInfo": SERVER_INFO,
      "io.groundcontrol/toolsetRevision": TOOLSET_REVISION,
    },
  };
}

function rpc(
  id: JsonRpcRequest["id"],
  result: unknown,
  modern: boolean,
  status = 200,
  headers?: Record<string, string>
) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, result: addServerMeta(result, modern) },
    { status, headers: responseHeaders(modern, headers) }
  );
}

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  modern: boolean,
  status = 200,
  data?: unknown,
  headers?: Record<string, string>
) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }, {
    status,
    headers: responseHeaders(modern, headers),
  });
}

function escapeChallenge(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function bearerChallenge(
  req: NextRequest,
  error: "invalid_token" | "insufficient_scope",
  description: string,
  scope?: string
) {
  const pieces = [
    `Bearer resource_metadata="${escapeChallenge(protectedResourceMetadataUrl(requestOrigin(req)))}"`,
    `error="${error}"`,
    `error_description="${escapeChallenge(description)}"`,
  ];
  if (scope) pieces.push(`scope="${escapeChallenge(scope)}"`);
  return pieces.join(", ");
}

function authToolResult(
  req: NextRequest,
  body: JsonRpcRequest,
  modern: boolean,
  error: OAuthBearerError
) {
  const kind = error.status === 403 ? "insufficient_scope" : "invalid_token";
  const challenge = bearerChallenge(req, kind, error.message, error.requiredScope);
  return rpc(body.id, {
    content: [{ type: "text", text: error.message }],
    isError: true,
    _meta: {
      "mcp/www_authenticate": [challenge],
    },
  }, modern, 200, {
    "WWW-Authenticate": challenge,
  });
}

function negotiateLegacyVersion(body: JsonRpcRequest): string {
  const requested = String(body.params?.protocolVersion || LEGACY_PROTOCOL_VERSION);
  return LEGACY_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LEGACY_PROTOCOL_VERSION;
}

export async function POST(req: NextRequest) {
  let body: JsonRpcRequest;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error", false, 400);
  }
  if (body.jsonrpc !== "2.0" || !body.method) {
    return rpcError(body.id, -32600, "Invalid Request", false, 400);
  }

  const modern = isModernRequest(req, body);
  const methodHeader = req.headers.get("mcp-method");
  if (methodHeader && methodHeader !== body.method) {
    return rpcError(body.id, -32020, "Mcp-Method header does not match JSON-RPC method", modern, 400);
  }

  if (body.method === "notifications/initialized") {
    return new NextResponse(null, {
      status: 202,
      headers: responseHeaders(false),
    });
  }

  // Discovery is deliberately public. ChatGPT must be able to learn which
  // actions exist and which OAuth scopes each action requires before invoking
  // a user-specific tool.
  if (body.method === "initialize") {
    return rpc(body.id, {
      protocolVersion: negotiateLegacyVersion(body),
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: SERVER_INSTRUCTIONS,
    }, false);
  }

  if (body.method === "server/discover") {
    return rpc(body.id, {
      supportedVersions: [MCP_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS],
      capabilities: { tools: { listChanged: false } },
      instructions: SERVER_INSTRUCTIONS,
      ttlMs: 30_000,
      cacheScope: "private",
      _meta: {
        "io.modelcontextprotocol/serverInfo": SERVER_INFO,
      },
    }, true);
  }

  if (body.method === "ping") return rpc(body.id, {}, modern);

  if (body.method === "tools/list") {
    return rpc(body.id, {
      tools: toolDefinitionsForScopes(),
      ...(modern ? { ttlMs: 5_000, cacheScope: "private" } : {}),
    }, modern);
  }

  if (body.method === "tools/call") {
    const params = body.params || {};
    const name = String(params.name || "");
    const nameHeader = req.headers.get("mcp-name");
    if (nameHeader && nameHeader !== name) {
      return rpcError(body.id, -32020, "Mcp-Name header does not match tool name", modern, 400);
    }
    if (!name) return rpcError(body.id, -32602, "Tool name is required", modern);

    let context: Awaited<ReturnType<typeof authenticateAccessToken>>;
    try {
      context = await authenticateAccessToken(req);
    } catch (error) {
      const authError = error instanceof OAuthBearerError
        ? error
        : new OAuthBearerError("A valid GroundControl OAuth access token is required", 401);
      return authToolResult(req, body, modern, authError);
    }

    try {
      const result = await executeAgentTool(
        context,
        name,
        params.arguments && typeof params.arguments === "object"
          ? params.arguments as Record<string, unknown>
          : {}
      );
      return rpc(body.id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      }, modern);
    } catch (error) {
      if (error instanceof OAuthBearerError) {
        return authToolResult(req, body, modern, error);
      }
      const message = error instanceof Error ? error.message : String(error);
      return rpc(body.id, {
        content: [{ type: "text", text: message }],
        isError: true,
      }, modern);
    }
  }

  return rpcError(body.id, -32601, `Method not found: ${body.method}`, modern);
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    error: "method_not_allowed",
    message: "GroundControl MCP uses Streamable HTTP POST requests.",
  }, {
    status: 405,
    headers: {
      Allow: "POST",
      "WWW-Authenticate": bearerChallenge(
        req,
        "invalid_token",
        "Use OAuth to call GroundControl tools."
      ),
    },
  });
}
