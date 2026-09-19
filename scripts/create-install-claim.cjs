#!/usr/bin/env node
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const INSTANCE_ID_KEY = "groundcontrol_instance_id";

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ttlMinutes() {
  const index = process.argv.indexOf("--ttl-minutes");
  const value = index >= 0 ? Number(process.argv[index + 1]) : Number(process.env.GC_CLAIM_TTL_MINUTES || 30);
  if (!Number.isFinite(value)) return 30;
  return Math.min(120, Math.max(5, Math.trunc(value)));
}

async function instanceId() {
  const existing = await prisma.appConfig.findUnique({ where: { key: INSTANCE_ID_KEY } });
  if (existing && existing.value) return existing.value;
  const value = `gc_${randomUUID()}`;
  const row = await prisma.appConfig.upsert({
    where: { key: INSTANCE_ID_KEY },
    create: { key: INSTANCE_ID_KEY, value },
    update: {},
  });
  return row.value;
}

async function main() {
  const users = await prisma.user.count();
  const id = await instanceId();

  if (users > 0) {
    process.stdout.write(JSON.stringify({
      product: "groundcontrol",
      stage: "already_claimed",
      instanceId: id,
    }) + "\n");
    return;
  }

  const now = new Date();
  await prisma.installClaim.updateMany({
    where: { status: "active" },
    data: { status: "revoked" },
  });

  const rawToken = `gc_claim_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + ttlMinutes() * 60 * 1000);
  const claim = await prisma.installClaim.create({
    data: {
      instanceId: id,
      tokenHash: hash(rawToken),
      status: "active",
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });

  process.stdout.write(JSON.stringify({
    product: "groundcontrol",
    stage: "claim_required",
    instanceId: id,
    claimId: claim.id,
    claimToken: rawToken,
    expiresAt: claim.expiresAt.toISOString(),
  }) + "\n");
}

main()
  .catch((error) => {
    console.error("[create-install-claim]", error && error.message ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
