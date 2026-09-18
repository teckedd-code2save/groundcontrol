import { NextRequest, NextResponse } from "next/server";
import { generateOpaqueToken, isAllowedRedirectUri } from "@/lib/oauth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      client_name?: string;
      redirect_uris?: string[];
      token_endpoint_auth_method?: string;
    };
    const redirectUris = Array.isArray(body.redirect_uris)
      ? Array.from(new Set(body.redirect_uris.filter((uri) => typeof uri === "string" && isAllowedRedirectUri(uri))))
      : [];
    if (!redirectUris.length) {
      return NextResponse.json({ error: "invalid_client_metadata", error_description: "At least one HTTPS or localhost redirect URI is required." }, { status: 400 });
    }
    if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
      return NextResponse.json({ error: "invalid_client_metadata", error_description: "GroundControl currently supports public PKCE clients only." }, { status: 400 });
    }
    const clientId = generateOpaqueToken("gc_client");
    const client = await prisma.oAuthClient.create({
      data: {
        clientId,
        clientName: String(body.client_name || "MCP client").trim().slice(0, 160) || "MCP client",
        redirectUris: JSON.stringify(redirectUris),
        source: "dynamic",
        tokenEndpointAuthMethod: "none",
      },
    });
    return NextResponse.json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
    }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: "invalid_client_metadata",
      error_description: error instanceof Error ? error.message : "Could not register OAuth client",
    }, { status: 400 });
  }
}
