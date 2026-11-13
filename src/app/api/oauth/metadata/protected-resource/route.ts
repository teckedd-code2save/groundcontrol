import { NextRequest, NextResponse } from "next/server";
import { OAUTH_SCOPES, mcpResource, requestOrigin } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  let origin: string;
  try { origin = await requestOrigin(req); } catch {
    return NextResponse.json({ error: "server_error", error_description: "GroundControl OAuth origin is unavailable. Review the instance published address." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/agents`,
  }, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
