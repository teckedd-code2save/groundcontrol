// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import type { AgentAccessContext } from "./mcp-agent";
let db: PrismaClient;
let directory: string;
// Inject a real isolated SQLite client, never a developer or production database.
vi.mock("./prisma", () => ({ get prisma() { return db; } }));
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "gc-proposal-test-"));
  const url = `file:${join(directory, "test.db")}`;
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  db = new PrismaClient({ datasources: { db: { url } } });
  vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS", "1");
}, 30000);
afterAll(async () => { if (db) await db.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
it("same-permission reconsent increments the epoch and cannot revive an old proposal", async () => {
  const { replaceConsent } = await import("./oauth-consent");
  const { createAgentDeploymentProposal, getOwnerDeploymentProposal } = await import("./agent-enrollment");
  const user = await db.user.create({ data: { username: "epoch-owner", password: "not-a-real-password", role: "admin" } });
  const client = await db.oAuthClient.create({ data: { clientId: "epoch-client", clientName: "test" } });
  const consent = { userId: user.id, clientDbId: client.id, scope: "deployment:propose", resourceIds: [], redirectUri: "https://example.test/callback", codeChallenge: "testchallenge", codeChallengeMethod: "S256" };
  await replaceConsent(consent);
  const first = await db.oAuthGrant.findUniqueOrThrow({ where: { userId_clientDbId: { userId: user.id, clientDbId: client.id } } });
  expect(first.consentRevision).toBe(1);
  const token = await db.oAuthToken.create({ data: { grantId: first.id, kind: "access", tokenHash: "unique-test-hash", familyId: "family", scope: consent.scope, expiresAt: new Date(Date.now()+60000) } });
  const context = { token, grant: first, user, scopes: new Set(["deployment:propose"]) } as unknown as AgentAccessContext;
  const proposal = await createAgentDeploymentProposal(context, { repositoryUrl: "https://github.com/example/service", revision: "a".repeat(40), runtime: "compose", composePath: "compose.yml", workloadName: "test", idempotencyKey: "consent-epoch-test" });
  expect((await getOwnerDeploymentProposal(user.id, proposal.id)).id).toBe(proposal.id);
  await db.oAuthGrant.update({ where: { id: first.id }, data: { revokedAt: new Date() } });
  await replaceConsent(consent);
  const second = await db.oAuthGrant.findUniqueOrThrow({ where: { id: first.id } });
  expect(second.consentRevision).toBe(2);
  expect(second.scope).toBe(first.scope);
  expect(second.resources).toBe(first.resources);
  expect(second.revokedAt).toBeNull();
  await expect(getOwnerDeploymentProposal(user.id, proposal.id)).rejects.toThrow("authorization changed");
});
