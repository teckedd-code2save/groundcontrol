import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { createAuthorizationCode } from "./oauth";

/** Bootstrap permission carries no workload access or execution authority. */
export function allowsResourceFreeConsent(scope: string): boolean {
  const scopes = scope.trim().split(/\s+/);
  return process.env.GC_AGENT_ENROLLMENT_PROPOSALS === "1"
    && scopes.includes("deployment:propose")
    && scopes.every((item) => item === "deployment:propose" || item === "offline_access");
}

export async function replaceConsent(input: {
  userId: number;
  clientDbId: number;
  scope: string;
  resourceIds: number[];
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}) {
  return prisma.$transaction(async (tx) => {
    const grant = await tx.oAuthGrant.upsert({
      where: { userId_clientDbId: { userId: input.userId, clientDbId: input.clientDbId } },
      create: {
        consentRevision: 1,
        userId: input.userId,
        clientDbId: input.clientDbId,
        scope: input.scope,
        resources: JSON.stringify(input.resourceIds),
      },
      update: { consentRevision: { increment: 1 }, scope: input.scope, resources: JSON.stringify(input.resourceIds), revokedAt: null },
    });
    const now = new Date();
    await tx.oAuthToken.updateMany({
      where: { grantId: grant.id, revokedAt: null },
      data: { revokedAt: now },
    });
    // An outstanding code must not restore a superseded scope after rotation.
    await tx.oAuthAuthorizationCode.updateMany({
      where: { grantId: grant.id, usedAt: null },
      data: { usedAt: now },
    });
    return createAuthorizationCode({
      grantId: grant.id,
      redirectUri: input.redirectUri,
      scope: input.scope,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
    }, tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
