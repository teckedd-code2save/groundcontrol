import { NextRequest, NextResponse } from "next/server";
import { OAUTH_SCOPES, requestOrigin } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  const issuer = requestOrigin(req);
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: OAUTH_SCOPES,
  }, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
