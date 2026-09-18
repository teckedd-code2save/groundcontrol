import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAccessToken,
  MCP_PROTOCOL_VERSION,
  OAuthBearerError,
  protectedResourceMetadataUrl,
  requestOrigin,
} from "@/lib/oauth";
import { executeAgentTool, toolDefinitionsForScopes } from "@/lib/mcp-agent";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function rpc(id: JsonRpcRequest["id"], result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
  });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 200, data?: unknown, headers?: Record<string, string>) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...headers,
    },
  });
}

function bearerChallenge(req: NextRequest, error?: string, scope?: string) {
  const pieces = [`Bearer resource_metadata="${protectedResourceMetadataUrl(requestOrigin(req))}"`];
  if (error) pieces.push(`error="${error}"`);
  if (scope) pieces.push(`scope="${scope}"`);
  return pieces.join(", ");
}

export async function POST(req: NextRequest) {
  let body: JsonRpcRequest;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (body.jsonrpc !== "2.0" || !body.method) {
    return rpcError(body.id, -32600, "Invalid Request", 400);
  }

  let context: Awaited<ReturnType<typeof authenticateAccessToken>>;
  try {
    context = await authenticateAccessToken(req);
  } catch (error) {
    if (error instanceof OAuthBearerError) {
      return rpcError(body.id, -32001, error.message, error.status, undefined, {
        "WWW-Authenticate": bearerChallenge(req, error.status === 403 ? "insufficient_scope" : "invalid_token", error.requiredScope),
      });
    }
    return rpcError(body.id, -32001, "Unauthorized", 401, undefined, {
      "WWW-Authenticate": bearerChallenge(req, "invalid_token"),
    });
  }

  const methodHeader = req.headers.get("mcp-method");
  if (methodHeader && methodHeader !== body.method) {
    return rpcError(body.id, -32600, "Mcp-Method header does not match JSON-RPC method", 400);
  }

  if (body.method === "notifications/initialized") {
    return new NextResponse(null, { status: 202, headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } });
  }

  if (body.method === "initialize") {
    return rpc(body.id, {
      protocolVersion: String(body.params?.protocolVersion || "2025-11-25"),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "GroundControl", version: "0.1.0" },
      instructions: "GroundControl exposes scoped infrastructure operations. Use durable operation handles rather than shell access.",
    });
  }

  if (body.method === "server/discover") {
    return rpc(body.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: "GroundControl", version: "0.1.0" },
      capabilities: { tools: { listChanged: false } },
    });
  }

  if (body.method === "ping") return rpc(body.id, {});

  if (body.method === "tools/list") {
    return rpc(body.id, {
      tools: toolDefinitionsForScopes(context.scopes),
      ttlMs: 30_000,
      cacheScope: "private",
    });
  }

  if (body.method === "tools/call") {
    const params = body.params || {};
    const name = String(params.name || "");
    const nameHeader = req.headers.get("mcp-name");
    if (nameHeader && nameHeader !== name) {
      return rpcError(body.id, -32600, "Mcp-Name header does not match tool name", 400);
    }
    if (!name) return rpcError(body.id, -32602, "Tool name is required");
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
      });
    } catch (error) {
      if (error instanceof OAuthBearerError) {
        return rpcError(body.id, -32002, error.message, 403, undefined, {
          "WWW-Authenticate": bearerChallenge(req, "insufficient_scope", error.requiredScope),
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      return rpc(body.id, {
        content: [{ type: "text", text: message }],
        isError: true,
      });
    }
  }

  return rpcError(body.id, -32601, `Method not found: ${body.method}`);
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    error: "method_not_allowed",
    message: "GroundControl MCP uses stateless HTTP POST requests.",
  }, {
    status: 405,
    headers: {
      Allow: "POST",
      "WWW-Authenticate": bearerChallenge(req),
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
  });
}
