import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mcpResource, parseResourceIds, requestOrigin } from "@/lib/oauth";

async function currentAdmin(req: NextRequest) {
  const tokenUser = requireAuth(req);
  const user = await prisma.user.findUnique({
    where: { id: tokenUser.id },
    select: { id: true, username: true, role: true, forcePasswordChange: true },
  });
  if (!user || user.role !== "admin" || user.forcePasswordChange) throw new Error("Administrator access required");
  return user;
}

export async function GET(req: NextRequest) {
  try {
    const user = await currentAdmin(req);
    const grants = await prisma.oAuthGrant.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { client: true },
    });
    const allIds = Array.from(new Set(grants.flatMap((grant) => parseResourceIds(grant.resources))));
    const deployments = await prisma.enrolledDeployment.findMany({
      where: { id: { in: allIds } },
      select: { id: true, name: true, slug: true },
    });
    const byId = new Map(deployments.map((deployment) => [deployment.id, deployment]));
    const origin = requestOrigin(req);
    return NextResponse.json({
      mcpUrl: mcpResource(origin),
      oauthIssuer: origin,
      grants: grants.map((grant) => ({
        id: grant.id,
        client: {
          id: grant.client.clientId,
          name: grant.client.clientName,
          source: grant.client.source,
        },
        scopes: grant.scope.split(" ").filter(Boolean),
        deployments: parseResourceIds(grant.resources).map((id) => byId.get(id) || { id, name: "Removed deployment", slug: String(id) }),
        revoked: Boolean(grant.revokedAt),
        createdAt: grant.createdAt,
        updatedAt: grant.updatedAt,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load agent access" }, { status: 403 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await currentAdmin(req);
    const { grantId } = await req.json() as { grantId?: number };
    if (!Number.isSafeInteger(grantId) || Number(grantId) <= 0) {
      return NextResponse.json({ error: "grantId is required" }, { status: 400 });
    }
    const grant = await prisma.oAuthGrant.findFirst({ where: { id: Number(grantId), userId: user.id } });
    if (!grant) return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    const now = new Date();
    await prisma.$transaction([
      prisma.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: now } }),
      prisma.oAuthToken.updateMany({ where: { grantId: grant.id, revokedAt: null }, data: { revokedAt: now } }),
      prisma.agentOperation.updateMany({
        where: { grantId: grant.id, status: "pending" },
        data: { status: "cancelled", error: "Agent grant revoked before operation started", finishedAt: now, leaseUntil: null },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not revoke agent access" }, { status: 403 });
  }
}
