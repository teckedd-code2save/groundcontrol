import { NextRequest, NextResponse } from "next/server";
import {
  hashOpaqueToken,
  issueTokenPair,
  refreshClientMatches,
  verifyPkce,
} from "@/lib/oauth";
import { prisma } from "@/lib/prisma";

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  const params = new URLSearchParams(await req.text());
  const grantType = params.get("grant_type") || "";
  const clientId = params.get("client_id") || "";

  if (grantType === "authorization_code") {
    const rawCode = params.get("code") || "";
    const verifier = params.get("code_verifier") || "";
    const redirectUri = params.get("redirect_uri") || "";
    if (!rawCode || !verifier || !redirectUri || !clientId) {
      return oauthError("invalid_request", "code, code_verifier, redirect_uri and client_id are required");
    }
    const code = await prisma.oAuthAuthorizationCode.findUnique({
      where: { codeHash: hashOpaqueToken(rawCode) },
      include: { grant: { include: { client: true } } },
    });
    if (
      !code ||
      code.usedAt ||
      code.expiresAt <= new Date() ||
      code.redirectUri !== redirectUri ||
      code.grant.client.clientId !== clientId ||
      code.grant.revokedAt
    ) {
      return oauthError("invalid_grant", "Authorization code is invalid, expired, or already used");
    }
    if (code.codeChallengeMethod !== "S256" || !verifyPkce(verifier, code.codeChallenge)) {
      return oauthError("invalid_grant", "PKCE verification failed");
    }
    const claimed = await prisma.oAuthAuthorizationCode.updateMany({
      where: { id: code.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return oauthError("invalid_grant", "Authorization code was already consumed");

    const pair = await issueTokenPair({ grantId: code.grantId, scope: code.scope });
    return NextResponse.json({
      access_token: pair.accessToken,
      token_type: "Bearer",
      expires_in: pair.expiresIn,
      scope: pair.scope,
      ...(pair.refreshToken ? { refresh_token: pair.refreshToken } : {}),
    }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  }

  if (grantType === "refresh_token") {
    const rawRefresh = params.get("refresh_token") || "";
    if (!rawRefresh) return oauthError("invalid_request", "refresh_token is required");
    const refresh = await prisma.oAuthToken.findUnique({
      where: { tokenHash: hashOpaqueToken(rawRefresh) },
      include: { grant: { include: { client: true } } },
    });
    if (
      !refresh ||
      refresh.kind !== "refresh" ||
      refresh.revokedAt ||
      refresh.expiresAt <= new Date() ||
      refresh.grant.revokedAt ||
      !refreshClientMatches({
        expectedClientId: refresh.grant.client.clientId,
        tokenEndpointAuthMethod: refresh.grant.client.tokenEndpointAuthMethod,
        presentedClientId: clientId,
      })
    ) {
      return oauthError("invalid_grant", "Refresh token is invalid, expired, or revoked");
    }

    const rotated = await prisma.oAuthToken.updateMany({
      where: { id: refresh.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) return oauthError("invalid_grant", "Refresh token was already rotated");
    await prisma.oAuthToken.updateMany({
      where: { familyId: refresh.familyId, kind: "access", revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const pair = await issueTokenPair({
      grantId: refresh.grantId,
      scope: refresh.scope,
      familyId: refresh.familyId,
    });
    return NextResponse.json({
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      token_type: "Bearer",
      expires_in: pair.expiresIn,
      scope: pair.scope,
    }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}
