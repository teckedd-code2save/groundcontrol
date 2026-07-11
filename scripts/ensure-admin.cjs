#!/usr/bin/env node
/**
 * Create the first admin account from env vars (docker entrypoint + bootstrap).
 *
 * Env (plain):
 *   GC_SETUP_USERNAME  — login id (email-style supported). Default: admin
 *   GC_SETUP_PASSWORD  — plain password (required to create)
 *
 * Env (base64 — preferred when shell-quoting passwords is hard):
 *   GC_SETUP_USERNAME_B64
 *   GC_SETUP_PASSWORD_B64
 *
 * Idempotent: no-op if any user already exists.
 * New accounts get forcePasswordChange=true so the operator updates on first login.
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

function fromEnv(plainKey, b64Key, fallback) {
  if (process.env[b64Key]) {
    try {
      return Buffer.from(process.env[b64Key], "base64").toString("utf8").trim();
    } catch {
      return "";
    }
  }
  const plain = (process.env[plainKey] || "").trim();
  if (plain) return plain;
  return fallback || "";
}

async function main() {
  const password = fromEnv("GC_SETUP_PASSWORD", "GC_SETUP_PASSWORD_B64", "");
  if (!password) {
    console.log("[ensure-admin] no password provided; skipping.");
    return;
  }

  const username = fromEnv("GC_SETUP_USERNAME", "GC_SETUP_USERNAME_B64", "admin");
  if (username.length < 2) {
    console.error("[ensure-admin] username must be at least 2 characters.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      console.log("[ensure-admin] users already exist; skipping.");
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        username,
        password: hash,
        role: "admin",
        forcePasswordChange: true,
      },
    });
    console.log(`[ensure-admin] created admin account: ${username}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[ensure-admin] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
