import { NextRequest, NextResponse } from "next/server";
import { supportedOAuthScopes, mcpResource, requestOrigin } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  return NextResponse.json({
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: supportedOAuthScopes(),
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/agents`,
  }, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
