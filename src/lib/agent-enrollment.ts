import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import type { AgentAccessContext } from "./mcp-agent";

export const agentEnrollmentEnabled = () => process.env.GC_AGENT_ENROLLMENT_PROPOSALS === "1";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type DeploymentProposalInput = {
  repositoryUrl: string; revision: string; runtime: "compose";
  composePath: string; workloadName: string; serverId: number | null;
};
export function normalizeDeploymentProposal(raw: Record<string, unknown>): DeploymentProposalInput {
  const allowed = new Set(["repositoryUrl", "revision", "runtime", "composePath", "workloadName", "serverId", "idempotencyKey"]);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new Error("Unknown proposal field; secrets and configuration values are not accepted");
  if (typeof raw.repositoryUrl !== "string" || raw.repositoryUrl.length > 220 || !/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}(?:\.git)?$/.test(raw.repositoryUrl)) throw new Error("Use a public HTTPS github.com owner/repository URL without credentials, query, or fragment");
  const repositoryUrl = raw.repositoryUrl.replace(/\.git$/, "");
  if ([".", ".."].includes(repositoryUrl.split("/").pop()!)) throw new Error("Invalid repository");
  if (typeof raw.revision !== "string" || !/^[a-fA-F0-9]{40}$/.test(raw.revision)) throw new Error("An immutable 40-character commit SHA is required");
  if (raw.runtime !== "compose") throw new Error("Only compose proposals are supported");
  if (typeof raw.composePath !== "string" || raw.composePath.length > 200 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.ya?ml$/.test(raw.composePath) || raw.composePath.split("/").some(part => part === "." || part === "..")) throw new Error("Use a repository-relative Compose YAML path without traversal");
  if (typeof raw.workloadName !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(raw.workloadName)) throw new Error("Use a lowercase workload name of up to 48 characters");
  if (raw.serverId != null && (typeof raw.serverId !== "number" || !Number.isSafeInteger(raw.serverId) || raw.serverId < 1)) throw new Error("Invalid server id");
  return { repositoryUrl, revision: raw.revision.toLowerCase(), runtime: "compose", composePath: raw.composePath, workloadName: raw.workloadName, serverId: raw.serverId as number | undefined ?? null };
}
export function deploymentProposalContentHash(input: DeploymentProposalInput) { return hash(JSON.stringify(input)); }
export function deploymentProposalGrantHash(grant: { id: number; userId: number; clientDbId: number; consentRevision: number; scope: string; resources: string }) {
  return hash(JSON.stringify([grant.id, grant.userId, grant.clientDbId, grant.consentRevision, grant.scope, grant.resources]));
}
async function activeGrant(grantId: number, userId: number) {
  const grant = await prisma.oAuthGrant.findUnique({ where: { id: grantId }, include: { user: true } });
  if (!grant || grant.userId !== userId || grant.revokedAt || grant.user.role !== "admin" || grant.user.forcePasswordChange || !grant.scope.split(" ").includes("deployment:propose")) throw new Error("Proposal access is no longer authorized");
  return grant;
}
async function agentGrant(context: AgentAccessContext) {
  if (!agentEnrollmentEnabled()) throw new Error("Deployment proposals are not enabled");
  if (!context.scopes.has("deployment:propose")) throw new Error("Missing scope deployment:propose");
  const token = await prisma.oAuthToken.findUnique({ where: { id: context.token.id } });
  if (!token || token.grantId !== context.grant.id || token.kind !== "access" || token.revokedAt || token.expiresAt <= new Date() || !token.scope.split(" ").includes("deployment:propose")) throw new Error("Proposal token is no longer authorized");
  return activeGrant(context.grant.id, context.user.id);
}
function publicProposal(proposal: { id: string; inputJson: string; contentHash: string; status: string; expiresAt: Date; createdAt: Date }) {
  const status = proposal.status === "pending" && proposal.expiresAt <= new Date() ? "expired" : proposal.status;
  const notice = status === "accepted"
    ? "Owner accepted the deployment reservation. Acceptance is not launch success. After separate resource consent, use deployment.list and operation.get to inspect execution."
    : status === "expired"
      ? "This proposal expired and cannot be accepted. Request a new proposal."
      : "Awaiting owner acceptance. Review may fetch the pinned Compose file; this proposal does not grant permission to run it.";
  return { id: proposal.id, ownerReviewPath: `/agent-proposals/${encodeURIComponent(proposal.id)}`, input: JSON.parse(proposal.inputJson) as DeploymentProposalInput, contentHash: proposal.contentHash, status, expiresAt: proposal.expiresAt.toISOString(), createdAt: proposal.createdAt.toISOString(), notice };
}
export async function createAgentDeploymentProposal(context: AgentAccessContext, raw: Record<string, unknown>) {
  const grant = await agentGrant(context);
  const input = normalizeDeploymentProposal(raw);
  if (typeof raw.idempotencyKey !== "string" || !/^[A-Za-z0-9_.:-]{8,160}$/.test(raw.idempotencyKey)) throw new Error("Use an idempotency key of 8–160 safe characters");
  const inputJson = JSON.stringify(input), contentHash = hash(inputJson), snapshot = deploymentProposalGrantHash(grant);
  const proposal = await prisma.agentDeploymentProposal.upsert({
    where: { grantId_idempotencyKey: { grantId: grant.id, idempotencyKey: raw.idempotencyKey } }, update: {},
    create: { grantId: grant.id, userId: grant.userId, idempotencyKey: raw.idempotencyKey, inputJson, contentHash, grantHash: snapshot, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
  if (proposal.contentHash !== contentHash || proposal.grantHash !== snapshot) throw new Error("Idempotency key already belongs to a different proposal or grant revision");
  const currentGrant = await activeGrant(grant.id, grant.userId);
  if (deploymentProposalGrantHash(currentGrant) !== snapshot) throw new Error("Authorization changed while creating proposal");
  return publicProposal(proposal);
}
export async function getAgentDeploymentProposal(context: AgentAccessContext, id: string) {
  const grant = await agentGrant(context);
  const proposal = await prisma.agentDeploymentProposal.findFirst({ where: { id, grantId: grant.id, userId: grant.userId } });
  if (!proposal || proposal.grantHash !== deploymentProposalGrantHash(grant) || hash(proposal.inputJson) !== proposal.contentHash) throw new Error("Proposal not found or authorization changed");
  return publicProposal(proposal);
}
export async function getOwnerDeploymentProposal(userId: number, id: string) {
  if (!agentEnrollmentEnabled()) throw new Error("Deployment proposals are not enabled");
  const proposal = await prisma.agentDeploymentProposal.findFirst({ where: { id, userId } });
  if (!proposal) throw new Error("Proposal not found");
  if (hash(proposal.inputJson) !== proposal.contentHash) throw new Error("Proposal content changed");
  // An accepted outcome belongs to its owner, independently of later resource consent.
  // This read does not revive the old proposal grant or confer execution authority.
  if (proposal.status === "accepted") {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "admin" || user.forcePasswordChange) throw new Error("A current administrator session is required");
    const recipe = await prisma.agentDeploymentRecipe.findFirst({ where: { proposalId: id, userId } });
    return { ...publicProposal(proposal), ...(recipe ? { deploymentId: recipe.deploymentId, launchStatus: recipe.status, operationId: recipe.launchOperationId } : {}) };
  }
  const grant = await activeGrant(proposal.grantId, userId);
  if (proposal.grantHash !== deploymentProposalGrantHash(grant) || hash(proposal.inputJson) !== proposal.contentHash) throw new Error("Proposal or authorization changed; request a new proposal");
  return publicProposal(proposal);
}
// Owner acceptance and execution are separate modules; proposal access never grants execution.
