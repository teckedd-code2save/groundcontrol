import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { allowsResourceFreeConsent, replaceConsent } from "@/lib/oauth-consent";
import { prisma } from "@/lib/prisma";
import {
  OAuthRequestError,
  readAuthorizationRequest,
  requestOrigin,
  validateAuthorizationRequest,
} from "@/lib/oauth";

function redirectWithError(redirectUri: string, state: string, issuer: string, error: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

export async function POST(req: NextRequest) {
  const tokenUser = getUserFromToken(req);
  if (!tokenUser) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: tokenUser.id },
    select: { id: true, username: true, role: true, forcePasswordChange: true },
  });
  if (!user || user.forcePasswordChange) return NextResponse.json({ error: "Authentication update required" }, { status: 401 });

  try {
    const body = await req.json() as {
      query?: string;
      approved?: boolean;
      deploymentIds?: number[];
    };
    const query = new URLSearchParams(String(body.query || ""));
    const authRequest = readAuthorizationRequest(query);
    const issuer = requestOrigin(req);
    const validated = await validateAuthorizationRequest(authRequest, issuer, user.role);

    if (!body.approved) {
      await createAuditLog(user.id, "oauth_consent_denied", req, { clientId: validated.client.clientId });
      return NextResponse.json({
        redirectTo: redirectWithError(authRequest.redirectUri, authRequest.state, issuer, "access_denied"),
      });
    }

    const requestedIds = Array.from(new Set(
      (Array.isArray(body.deploymentIds) ? body.deploymentIds : [])
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    ));
    if (!requestedIds.length && !allowsResourceFreeConsent(validated.scope)) {
      return NextResponse.json({ error: "Select at least one deployment for this agent." }, { status: 400 });
    }
    const allowed = await prisma.enrolledDeployment.findMany({
      where: { id: { in: requestedIds }, kind: { not: "source" } },
      select: { id: true },
    });
    if (allowed.length !== requestedIds.length) {
      return NextResponse.json({ error: "One or more selected deployments no longer exist." }, { status: 400 });
    }

    const code = await replaceConsent({
      userId: user.id,
      clientDbId: validated.client.id,
      scope: validated.scope,
      resourceIds: requestedIds,
      redirectUri: authRequest.redirectUri,
      codeChallenge: authRequest.codeChallenge,
      codeChallengeMethod: authRequest.codeChallengeMethod,
    });
    const redirect = new URL(authRequest.redirectUri);
    redirect.searchParams.set("code", code);
    if (authRequest.state) redirect.searchParams.set("state", authRequest.state);
    redirect.searchParams.set("iss", issuer);

    await createAuditLog(user.id, "oauth_consent_granted", req, {
      clientId: validated.client.clientId,
      scopes: validated.scope,
      deploymentIds: requestedIds,
    });

    return NextResponse.json({ redirectTo: redirect.toString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof OAuthRequestError) {
      return NextResponse.json({ error: error.error, error_description: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "server_error", error_description: error instanceof Error ? error.message : "Could not authorize client" }, { status: 500 });
  }
}
