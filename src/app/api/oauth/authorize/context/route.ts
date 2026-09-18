import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  OAUTH_SCOPE_LABELS,
  OAuthRequestError,
  parseResourceIds,
  readAuthorizationRequest,
  requestOrigin,
  validateAuthorizationRequest,
} from "@/lib/oauth";

export async function GET(req: NextRequest) {
  const tokenUser = getUserFromToken(req);
  if (!tokenUser) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: tokenUser.id },
    select: { id: true, username: true, role: true, forcePasswordChange: true },
  });
  if (!user || user.forcePasswordChange) return NextResponse.json({ error: "Authentication update required" }, { status: 401 });

  try {
    const authRequest = readAuthorizationRequest(req.nextUrl.searchParams);
    const validated = await validateAuthorizationRequest(authRequest, requestOrigin(req), user.role);
    const [deployments, existingGrant] = await Promise.all([
      prisma.enrolledDeployment.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          kind: true,
          status: true,
          vpsConfig: { select: { name: true } },
        },
      }),
      prisma.oAuthGrant.findUnique({
        where: { userId_clientDbId: { userId: user.id, clientDbId: validated.client.id } },
      }),
    ]);
    const requestedScopes = validated.scope.split(" ").filter(Boolean);
    return NextResponse.json({
      client: {
        id: validated.client.clientId,
        name: validated.client.clientName,
        source: validated.client.source,
      },
      scopes: requestedScopes.map((scope) => ({
        id: scope,
        label: OAUTH_SCOPE_LABELS[scope as keyof typeof OAUTH_SCOPE_LABELS] || scope,
        write: scope === "deployment:redeploy",
      })),
      deployments,
      selectedDeploymentIds: existingGrant && !existingGrant.revokedAt
        ? parseResourceIds(existingGrant.resources)
        : deployments.map((deployment) => deployment.id),
      user: { username: user.username, role: user.role },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OAuthRequestError) {
      return NextResponse.json({ error: error.error, error_description: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "server_error", error_description: error instanceof Error ? error.message : "Could not prepare consent" }, { status: 500 });
  }
}
