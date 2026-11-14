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
afterAll(async () => { if (db) await db.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

let index = 0;
const yaml = 'services:\n  web:\n    image: nginx:alpine\n    ports: ["127.0.0.1:8080:80"]\n';
async function fixture() {
  const { replaceConsent } = await import("./oauth-consent");
  const { createAgentDeploymentProposal } = await import("./agent-enrollment");
  const user = await db.user.create({ data: { username: `owner-${++index}`, password: "test-only", role: "admin" } });
  const client = await db.oAuthClient.create({ data: { clientId: `client-${index}`, clientName: "test" } });
  const host = await db.vpsConfig.create({ data: { name: "test", host: "192.0.2.5", privateKey: "must-not-leak" } });
  const consent = { userId: user.id, clientDbId: client.id, scope: "deployment:propose", resourceIds: [], redirectUri: "https://example.test/callback", codeChallenge: "challenge", codeChallengeMethod: "S256" };
  await replaceConsent(consent);
  const grant = await db.oAuthGrant.findUniqueOrThrow({ where: { userId_clientDbId: { userId: user.id, clientDbId: client.id } } });
  const token = await db.oAuthToken.create({ data: { grantId: grant.id, kind: "access", tokenHash: `test-${index}`, familyId: "f", scope: consent.scope, expiresAt: new Date(Date.now()+60000) } });
  const context = { token, grant, user, scopes: new Set(["deployment:propose"]) } as unknown as AgentAccessContext;
  const proposal = await createAgentDeploymentProposal(context, { repositoryUrl: "https://github.com/example/service", revision: "a".repeat(40), runtime: "compose", composePath: "compose.yml", workloadName: "test", idempotencyKey: "review-test-request" });
  const input = { contentHash: proposal.contentHash, serverId: host.id, health: { service: "web", port: 8080, path: "/" }, appAccess: { mode: "loopback", hostPort: 8080 }, budget: { maxServices: 1, cpusPerService: 0.5, memoryMbPerService: 256, pidsPerService: 64, timeoutSeconds: 60 }, allowUnboundedBuildResources: false };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(yaml)));
  return { user, host, grant, consent, proposal, input };
}
it("fetches pinned source, accepts exactly once and survives later resource reconsent", async () => {
  const { reviewOwnerDeploymentProposal, acceptOwnerDeploymentProposal } = await import("./agent-enrollment-review");
  const { replaceConsent } = await import("./oauth-consent");
  const f = await fixture();
  const review = await reviewOwnerDeploymentProposal(f.user.id, f.proposal.id, f.input);
  expect(review.plan.readyForOwnerReview).toBe(true);
  expect(JSON.stringify(review)).not.toContain("must-not-leak");
  expect(fetch).toHaveBeenCalledWith(`https://raw.githubusercontent.com/example/service/${"a".repeat(40)}/compose.yml`, expect.objectContaining({ redirect: "error", cache: "no-store" }));
  const accepted = await acceptOwnerDeploymentProposal(f.user.id, f.proposal.id, { reviewId: review.reviewId, reviewHash: review.reviewHash });
  expect(accepted.status).toBe("pending");
  expect(await db.agentOperation.count()).toBe(0);
  expect((await db.oAuthGrant.findUniqueOrThrow({ where: { id: f.grant.id } })).resources).toBe("[]");
  await replaceConsent({ ...f.consent, scope: "deployment:redeploy", resourceIds: [accepted.deploymentId] });
  expect(await acceptOwnerDeploymentProposal(f.user.id, f.proposal.id, { reviewId: review.reviewId, reviewHash: review.reviewHash })).toEqual(accepted);
  const { getOwnerDeploymentProposal } = await import("./agent-enrollment");
  await db.agentDeploymentProposal.update({ where: { id: f.proposal.id }, data: { expiresAt: new Date(0) } });
  const outcome = await getOwnerDeploymentProposal(f.user.id, f.proposal.id);
  expect(outcome.status).toBe("accepted");
  expect(outcome).toMatchObject({ deploymentId: accepted.deploymentId });
  expect(outcome.notice).toContain("Acceptance is not launch success");
  expect(outcome.notice).not.toContain("No repository has been fetched");
  expect(await db.agentDeploymentRecipe.count({ where: { proposalId: f.proposal.id } })).toBe(1);
  expect((await db.enrolledDeployment.findUniqueOrThrow({ where: { id: accepted.deploymentId } })).legacyProjectId).toBeNull();
});
it("rejects stale host or expired reviews without creating a workload", async () => {
  const { reviewOwnerDeploymentProposal, acceptOwnerDeploymentProposal } = await import("./agent-enrollment-review");
  const f = await fixture(); const review = await reviewOwnerDeploymentProposal(f.user.id, f.proposal.id, f.input);
  await db.vpsConfig.update({ where: { id: f.host.id }, data: { host: "192.0.2.6" } });
  await expect(acceptOwnerDeploymentProposal(f.user.id, f.proposal.id, { reviewId: review.reviewId, reviewHash: review.reviewHash })).rejects.toThrow("Server configuration changed");
  await db.agentDeploymentReview.update({ where: { id: review.reviewId }, data: { expiresAt: new Date(0) } });
  await expect(acceptOwnerDeploymentProposal(f.user.id, f.proposal.id, { reviewId: review.reviewId, reviewHash: review.reviewHash })).rejects.toThrow("expired");
  expect(await db.agentDeploymentRecipe.count({ where: { proposalId: f.proposal.id } })).toBe(0);
});
it("requires exact hash, current admin and proposal grant epoch", async () => {
  const { reviewOwnerDeploymentProposal, acceptOwnerDeploymentProposal } = await import("./agent-enrollment-review");
  const { replaceConsent } = await import("./oauth-consent");
  const f = await fixture(); const review = await reviewOwnerDeploymentProposal(f.user.id, f.proposal.id, f.input);
  await expect(acceptOwnerDeploymentProposal(f.user.id, f.proposal.id, { reviewId: review.reviewId, reviewHash: "b".repeat(64) })).rejects.toThrow("changed");
  await replaceConsent(f.consent);
  await expect(acceptOwnerDeploymentProposal(f.user.id, f.proposal.id, { reviewId: review.reviewId, reviewHash: review.reviewHash })).rejects.toThrow("authorization changed");
  await db.user.update({ where: { id: f.user.id }, data: { role: "viewer" } });
  await expect(reviewOwnerDeploymentProposal(f.user.id, f.proposal.id, f.input)).rejects.toThrow("administrator");
});
it("persists actionable blockers but does not accept unsafe Compose", async () => {
  const { reviewOwnerDeploymentProposal, acceptOwnerDeploymentProposal } = await import("./agent-enrollment-review");
  const f = await fixture(); vi.stubGlobal("fetch", vi.fn(async () => new Response(yaml.replace("127.0.0.1:", ""))));
  const review = await reviewOwnerDeploymentProposal(f.user.id, f.proposal.id, f.input);
  expect(review.plan.readyForOwnerReview).toBe(false);
  await expect(acceptOwnerDeploymentProposal(f.user.id, f.proposal.id, { reviewId: review.reviewId, reviewHash: review.reviewHash })).rejects.toThrow("blockers");
});
it("binds only candidate config refs, rejects stale saved config and links the dedicated project",async()=>{
 vi.stubEnv("GROUNDCONTROL_SECRET","a".repeat(64));
 const {saveProposalConfiguration}=await import("./agent-proposal-configuration");
 const {reviewOwnerDeploymentProposal,acceptOwnerDeploymentProposal}=await import("./agent-enrollment-review");
 const f=await fixture();
 const saved=await saveProposalConfiguration(f.user.id,f.proposal.id,{contentHash:f.proposal.contentHash,expectedRevision:0,values:[{service:"web",key:"QLOO_API_KEY",value:"SYNTHETIC_SECRET",required:true}]});
 const stale=await reviewOwnerDeploymentProposal(f.user.id,f.proposal.id,f.input);
 expect(JSON.stringify(stale)).not.toContain("SYNTHETIC_SECRET");
 expect(stale.configuration?.configuration.bindings[0]).toMatchObject({service:"web",key:"QLOO_API_KEY",version:1});
 await saveProposalConfiguration(f.user.id,f.proposal.id,{contentHash:f.proposal.contentHash,expectedRevision:1,values:[{service:"web",key:"QLOO_API_KEY",value:"SYNTHETIC_CHANGED",required:true}]});
 await expect(acceptOwnerDeploymentProposal(f.user.id,f.proposal.id,{reviewId:stale.reviewId,reviewHash:stale.reviewHash})).rejects.toThrow(/configuration changed/);
 const fresh=await reviewOwnerDeploymentProposal(f.user.id,f.proposal.id,f.input);
 expect(fresh.plan.readyForOwnerReview).toBe(true);
 const accepted=await acceptOwnerDeploymentProposal(f.user.id,f.proposal.id,{reviewId:fresh.reviewId,reviewHash:fresh.reviewHash});
 expect((await db.enrolledDeployment.findUniqueOrThrow({where:{id:accepted.deploymentId}})).legacyProjectId).toBe(saved.projectId);
 expect((await db.agentDeploymentRecipe.findUniqueOrThrow({where:{deploymentId:accepted.deploymentId}})).recipeJson).not.toMatch(/SYNTHETIC|enc:v1/);
});
it("blocks required empty config before owner acceptance",async()=>{
 const {saveProposalConfiguration}=await import("./agent-proposal-configuration");
 const {reviewOwnerDeploymentProposal}=await import("./agent-enrollment-review");
 const f=await fixture();
 await saveProposalConfiguration(f.user.id,f.proposal.id,{contentHash:f.proposal.contentHash,expectedRevision:0,values:[{service:"web",key:"QLOO_API_KEY",value:"",required:true}]});
 const review=await reviewOwnerDeploymentProposal(f.user.id,f.proposal.id,f.input);
 expect(review.plan.readyForOwnerReview).toBe(false);expect(review.plan.blockers.some(b=>b.field==="configuration")).toBe(true);
});
