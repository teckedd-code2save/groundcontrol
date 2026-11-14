// @vitest-environment node
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ path: `/tmp/gc-oauth-rotation-${process.pid}.db` }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${state.path}` }) };
});
import { prisma } from "@/lib/prisma";
import { POST } from "./route";
import { createAuthorizationCode, issueTokenPair, pkceChallenge } from "@/lib/oauth";
import { replaceConsent } from "@/lib/oauth-consent";
const verifier = "a".repeat(64);
const oldScope = "deployment:read offline_access";
let grantId: number;
let userId: number;
let clientDbId: number;
function request(values: Record<string, string>) {
  return new NextRequest("https://gc.example/oauth/token", { method: "POST", body: new URLSearchParams(values) });
}
function exchange(code: string) {
  return POST(request({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: "test-client", redirect_uri: "https://client.example/cb" }));
}
function refresh(token: string) {
  return POST(request({ grant_type: "refresh_token", refresh_token: token }));
}
function rotate() {
  return replaceConsent({ userId, clientDbId, scope: "deployment:propose", resourceIds: [], redirectUri: "https://client.example/cb", codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" });
}
function code() {
  return createAuthorizationCode({ grantId, scope: oldScope, redirectUri: "https://client.example/cb", codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" });
}
beforeAll(() => {
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: { ...process.env, DATABASE_URL: `file:${state.path}` }, stdio: "pipe" });
}, 30000);
beforeEach(async () => {
  await prisma.oAuthAuthorizationCode.deleteMany();
  await prisma.oAuthToken.deleteMany();
  await prisma.oAuthGrant.deleteMany();
  await prisma.oAuthClient.deleteMany();
  await prisma.user.deleteMany();
  const user = await prisma.user.create({ data: { username: "owner", password: "test-only" } });
  const client = await prisma.oAuthClient.create({ data: { clientId: "test-client", clientName: "Test" } });
  userId = user.id; clientDbId = client.id;
  grantId = (await prisma.oAuthGrant.create({ data: { userId, clientDbId, scope: oldScope, resources: "[1]" } })).id;
});
afterAll(async () => { await prisma.$disconnect(); rmSync(state.path, { force: true }); });
describe("transactional OAuth issuance against SQLite", () => {
  it("consumes a code once and rotates a refresh token once", async () => {
    const raw = await code();
    const first = await exchange(raw);
    expect(first.status).toBe(200);
    expect((await exchange(raw)).status).toBe(400);
    const pair = await first.json();
    expect((await refresh(pair.refresh_token)).status).toBe(200);
    expect((await refresh(pair.refresh_token)).status).toBe(400);
  });
  it("rejects outstanding codes and refresh tokens after consent replacement", async () => {
    const raw = await code();
    const pair = await issueTokenPair({ grantId, scope: oldScope });
    await rotate();
    expect((await exchange(raw)).status).toBe(400);
    expect((await refresh(pair.refreshToken!)).status).toBe(400);
  });
  it.each(["code", "refresh"])("does not retain old-scope tokens after concurrent %s issuance and committed rotation", async (kind) => {
    const raw = await code();
    const pair = await issueTokenPair({ grantId, scope: oldScope });
    const results = await Promise.allSettled([kind === "code" ? exchange(raw) : refresh(pair.refreshToken!), rotate()]);
    // A lock conflict may abort either transaction. Complete any aborted rotation before checking.
    if (results[1].status === "rejected") await rotate();
    expect(await prisma.oAuthToken.count({ where: { grantId, revokedAt: null, scope: oldScope } })).toBe(0);
    expect((await prisma.oAuthGrant.findUniqueOrThrow({ where: { id: grantId } })).scope).toBe("deployment:propose");
  });
  it("blocks forced-password-change accounts", async () => {
    const raw = await code();
    await prisma.user.update({ where: { id: userId }, data: { forcePasswordChange: true } });
    expect((await exchange(raw)).status).toBe(400);
  });
});
