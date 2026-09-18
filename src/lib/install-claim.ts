import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const INSTANCE_ID_KEY = "groundcontrol_instance_id";
const CLAIM_PREFIX = "gc_claim_";

export function hashInstallClaimToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function validInstallClaimToken(token: string) {
  return token.startsWith(CLAIM_PREFIX) && /^gc_claim_[A-Za-z0-9_-]{24,128}$/.test(token);
}

export async function ensureGroundControlInstanceId() {
  const existing = await prisma.appConfig.findUnique({ where: { key: INSTANCE_ID_KEY } });
  if (existing?.value) return existing.value;
  const value = `gc_${randomUUID()}`;
  const row = await prisma.appConfig.upsert({
    where: { key: INSTANCE_ID_KEY },
    create: { key: INSTANCE_ID_KEY, value },
    update: {},
  });
  return row.value;
}

export async function expireInstallClaims(now = new Date()) {
  await prisma.installClaim.updateMany({
    where: {
      status: "active",
      expiresAt: { lte: now },
    },
    data: { status: "expired" },
  });
}

export async function installClaimStatus() {
  const now = new Date();
  await expireInstallClaims(now);
  const [userCount, instanceId, activeClaim] = await Promise.all([
    prisma.user.count(),
    ensureGroundControlInstanceId(),
    prisma.installClaim.findFirst({
      where: { status: "active", expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { expiresAt: true, createdAt: true },
    }),
  ]);
  return {
    instanceId,
    claimed: userCount > 0,
    claimRequired: userCount === 0 && Boolean(activeClaim),
    setupRequired: userCount === 0 && !activeClaim,
    activeClaim: activeClaim
      ? {
          expiresAt: activeClaim.expiresAt,
          createdAt: activeClaim.createdAt,
        }
      : null,
  };
}
