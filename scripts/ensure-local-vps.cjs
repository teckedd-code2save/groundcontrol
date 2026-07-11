#!/usr/bin/env node
/**
 * Ensure at least one active VPS config exists.
 *
 * Bootstrap / docker installs run ON the host with the Docker socket mounted,
 * so "local" mode is the correct default. Without this, every API that needs
 * host access returns {"error":"No VPS configured"} after first login.
 *
 * Idempotent: no-op if any VpsConfig already exists.
 * If rows exist but none are active, activates the most recently updated one.
 */
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.vpsConfig.count();
    if (count === 0) {
      const name = (process.env.GC_VPS_NAME || "local").trim() || "local";
      await prisma.vpsConfig.create({
        data: {
          name,
          host: process.env.GC_VPS_HOST || "127.0.0.1",
          port: Number(process.env.GC_VPS_PORT || 22) || 22,
          username: process.env.GC_VPS_USERNAME || "root",
          authType: "key",
          isLocal: true,
          isActive: true,
        },
      });
      console.log(`[ensure-local-vps] created active local VPS config "${name}"`);
      return;
    }

    const active = await prisma.vpsConfig.count({ where: { isActive: true } });
    if (active === 0) {
      const latest = await prisma.vpsConfig.findFirst({ orderBy: { updatedAt: "desc" } });
      if (latest) {
        await prisma.vpsConfig.update({
          where: { id: latest.id },
          data: { isActive: true },
        });
        console.log(`[ensure-local-vps] activated existing VPS config id=${latest.id} name=${latest.name}`);
      }
    } else {
      console.log(`[ensure-local-vps] ${active} active VPS config(s) already present`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[ensure-local-vps] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
