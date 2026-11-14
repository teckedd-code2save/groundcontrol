import { captureProposalConfiguration } from "./agent-proposal-configuration";
import type { FirstLaunchConfiguration } from "./agent-first-launch-config";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { agentEnrollmentEnabled, deploymentProposalGrantHash, getOwnerDeploymentProposal, normalizeDeploymentProposal, type DeploymentProposalInput } from "./agent-enrollment";
import { prepareFirstDeployExecution, type ApprovedFirstDeployRecipe } from "./agent-first-deploy-execution";
import { planAgentFirstDeploy } from "./agent-first-deploy-plan";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(message: string): never { throw new Error(message); }
const plain = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail("Expected an object");
function exact(value: unknown, keys: string[]) {
  const obj = plain(value);
  if (Object.keys(obj).some(key => !keys.includes(key))) fail("Unknown review field; credentials and environment values are not accepted here");
  return obj;
}
function bounded(value: unknown, min: number, max: number, integer = true) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail(`Expected ${integer ? "integer" : "number"} between ${min} and ${max}`);
  return value as number;
}
export function normalizeOwnerReview(raw: unknown) {
  const body = exact(raw, ["contentHash", "serverId", "health", "appAccess", "budget", "allowUnboundedBuildResources"]);
  if (typeof body.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(body.contentHash)) fail("Invalid proposal content hash");
  const health = exact(body.health, ["service", "port", "path"]);
  if (typeof health.service !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(health.service)) fail("Choose the Compose service to check");
  if (typeof health.path !== "string" || !/^\/[A-Za-z0-9/_~.-]{0,199}$/.test(health.path)) fail("Use a health path without query parameters or credentials");
  const access = exact(body.appAccess, ["mode", "hostPort"]);
  if (access.mode !== "loopback") fail("Initial launches support explicit loopback access only; public routing needs separate setup");
  if (access.hostPort !== health.port) fail("The health port must equal the selected loopback host port");
  const budget = exact(body.budget, ["maxServices", "cpusPerService", "memoryMbPerService", "pidsPerService", "timeoutSeconds"]);
  if (typeof body.allowUnboundedBuildResources !== "boolean") fail("Explicit build execution acknowledgement is required");
  return {
    contentHash: body.contentHash as string, serverId: bounded(body.serverId, 1, Number.MAX_SAFE_INTEGER),
    health: { service: health.service as string, port: bounded(health.port, 1024, 65535), path: health.path as string },
    appAccess: { mode: "loopback" as const, hostPort: bounded(access.hostPort, 1024, 65535) },
    budget: { maxServices: bounded(budget.maxServices, 1, 10), cpusPerService: bounded(budget.cpusPerService, 0.1, 2, false), memoryMbPerService: bounded(budget.memoryMbPerService, 128, 2048), pidsPerService: bounded(budget.pidsPerService, 16, 512), timeoutSeconds: bounded(budget.timeoutSeconds, 30, 600) },
    allowUnboundedBuildResources: body.allowUnboundedBuildResources,
  };
}

/** Fixed trusted host, immutable path, no auth, no redirects, bounded time and bytes. */
export async function fetchPinnedCompose(input: DeploymentProposalInput): Promise<string> {
  input = normalizeDeploymentProposal(input);
  const repo = input.repositoryUrl.slice("https://github.com/".length).split("/");
  const path = [...repo, input.revision, ...input.composePath.split("/")].map(encodeURIComponent).join("/");
  const response = await fetch(`https://raw.githubusercontent.com/${path}`, { redirect: "error", signal: AbortSignal.timeout(10000), headers: { Accept: "text/plain" }, cache: "no-store" });
  if (!response.ok || !response.body) fail("Cannot fetch the pinned public Compose file. Check repository visibility, commit SHA and file path.");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 256 * 1024) { await response.body!.cancel(); fail("Compose file exceeds 256 KiB"); }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) fail("Compose file exceeds 256 KiB");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

const hostSelect = { id: true, name: true, host: true, port: true, username: true, authType: true, isLocal: true, updatedAt: true } as const;
async function owner(userId: number, db: Pick<Prisma.TransactionClient, "user"> = prisma) {
  if (!agentEnrollmentEnabled()) fail("Deployment proposals are not enabled");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "admin" || user.forcePasswordChange) fail("A current administrator session is required");
}
export async function ownerDeploymentProposalContext(userId: number, proposalId: string) {
  await owner(userId);
  const proposal = await getOwnerDeploymentProposal(userId, proposalId);
  const servers = await prisma.vpsConfig.findMany({ select: { id: true, name: true, host: true, isLocal: true }, orderBy: { id: "asc" } });
  return { proposal, servers };
}
export async function reviewOwnerDeploymentProposal(userId: number, proposalId: string, raw: unknown) {
  await owner(userId);
  const input = normalizeOwnerReview(raw);
  const proposal = await getOwnerDeploymentProposal(userId, proposalId);
  if (proposal.contentHash !== input.contentHash || proposal.status !== "pending") fail("Proposal changed, expired, or has already been accepted");
  const host = await prisma.vpsConfig.findUnique({ where: { id: input.serverId }, select: hostSelect });
  if (!host) fail("Choose an existing server");
  const composeYaml = await fetchPinnedCompose(proposal.input);
  const plan = planAgentFirstDeploy({ proposalId, repositoryUrl: proposal.input.repositoryUrl, commitSha: proposal.input.revision, composeFile: proposal.input.composePath, composeYaml });
  if (!plan.services.includes(input.health.service)) plan.blockers.push({ field: "health.service", message: "Choose a service present in the pinned Compose file." });
  if (plan.services.length > input.budget.maxServices) plan.blockers.push({ field: "budget.maxServices", message: "The Compose service count exceeds your approved budget." });
  plan.readyForOwnerReview = plan.blockers.length === 0;
  const candidateConfig = await captureProposalConfiguration(userId, proposalId, plan.services);
  if (candidateConfig?.missing.length) plan.blockers.push({ field: "configuration", message: `Missing required configuration: ${candidateConfig.missing.map(item => `${item.service}:${item.key}`).join(", ")}` });
  const persisted = await prisma.agentDeploymentProposal.findUniqueOrThrow({ where: { id: proposalId } });
  const envelope = {
    version: 1, proposalContentHash: proposal.contentHash, grantHash: persisted.grantHash,
    configurationRevision: candidateConfig?.revision ?? null,
    host: { ...host, updatedAt: host.updatedAt.toISOString() },
    recipe: { proposalId, repositoryUrl: proposal.input.repositoryUrl, commitSha: proposal.input.revision, composeFile: proposal.input.composePath, composeYaml, recipeHash: plan.recipeHash, ...(candidateConfig ? { configuration: candidateConfig.configuration } : {}), health: input.health, appAccess: input.appAccess, budget: input.budget, allowUnboundedBuildResources: input.allowUnboundedBuildResources },
    plan,
  };
  try { prepareFirstDeployExecution(envelope.recipe); }
  catch (error) { plan.blockers.push({ field: "execution", message: error instanceof Error ? error.message : "Recipe is not executable" }); }
  plan.readyForOwnerReview = plan.blockers.length === 0;
  const reviewJson = JSON.stringify(envelope), reviewHash = hash(reviewJson);
  const review = await prisma.agentDeploymentReview.create({ data: { proposalId, userId, reviewJson, reviewHash, expiresAt: new Date(Math.min(Date.now()+15*60*1000, Date.parse(proposal.expiresAt))) } });
  return { reviewId: review.id, reviewHash, expiresAt: review.expiresAt.toISOString(), proposal, sourceCompose: composeYaml, configuration: candidateConfig, plan, host: envelope.host, health: input.health, appAccess: input.appAccess, budget: input.budget, allowUnboundedBuildResources: input.allowUnboundedBuildResources, notice: "Accepting reserves this deployment only. It does not run code, open ports, or grant agent access. Builds execute untrusted code; build CPU/RAM and daemon-side duration are not bounded. The execution wait is limited; a timeout requires inspection before retrying." };
}

type ReviewEnvelope = Awaited<ReturnType<typeof reviewOwnerDeploymentProposal>>;
export async function acceptOwnerDeploymentProposal(userId: number, proposalId: string, raw: unknown) {
  const input = exact(raw, ["reviewId", "reviewHash"]);
  if (typeof input.reviewId !== "string" || input.reviewId.length > 128 || typeof input.reviewHash !== "string" || !/^[a-f0-9]{64}$/.test(input.reviewHash)) fail("Invalid review identity");
  return prisma.$transaction(async tx => {
    await owner(userId, tx);
    const review = await tx.agentDeploymentReview.findFirst({ where: { id: input.reviewId as string, proposalId, userId } });
    if (!review || review.reviewHash !== input.reviewHash || hash(review.reviewJson) !== input.reviewHash) fail("Review not found or changed");
    const existing = await tx.agentDeploymentRecipe.findUnique({ where: { proposalId } });
    if (existing) {
      if (existing.userId !== userId || existing.reviewId !== review.id || existing.recipeHash !== review.reviewHash) fail("This proposal was already accepted with another review");
      return { deploymentId: existing.deploymentId, recipeId: existing.id, status: existing.status, requiresResourceConsent: true, notice: "Deployment reserved; separate resource permission and first launch are required." };
    }
    if (review.expiresAt <= new Date()) fail("Review expired; review the proposal again");
    const proposal = await tx.agentDeploymentProposal.findFirst({ where: { id: proposalId, userId, status: "pending" } });
    if (!proposal || proposal.expiresAt <= new Date() || hash(proposal.inputJson) !== proposal.contentHash) fail("Proposal expired or changed");
    const grant = await tx.oAuthGrant.findUnique({ where: { id: proposal.grantId } });
    if (!grant || grant.userId !== userId || grant.revokedAt || !grant.scope.split(" ").includes("deployment:propose") || deploymentProposalGrantHash(grant) !== proposal.grantHash) fail("Proposal authorization changed; request a new proposal");
    const envelope = JSON.parse(review.reviewJson) as { version: number; proposalContentHash: string; grantHash: string; host: { id: number }; recipe: ApprovedFirstDeployRecipe & { configuration?: FirstLaunchConfiguration }; configurationRevision?: number | null; plan: ReviewEnvelope["plan"] };
    if (envelope.proposalContentHash !== proposal.contentHash || envelope.grantHash !== proposal.grantHash || !envelope.plan.readyForOwnerReview || envelope.plan.blockers.length) fail("Review contains unresolved blockers");
    prepareFirstDeployExecution(envelope.recipe);
    const mapping = await tx.agentProposalConfiguration.findUnique({ where: { proposalId } });
    const configuration = envelope.recipe.configuration;
    if (mapping || configuration) {
      if (!mapping || !configuration || mapping.userId !== userId || mapping.projectId !== configuration.projectId || mapping.profileId !== configuration.profileId || mapping.revision !== envelope.configurationRevision) fail("Review configuration changed; review again");
      const profile = await tx.deploymentEnvProfile.findUnique({ where: { id: mapping.profileId } });
      const project = await tx.project.findUnique({ where: { id: mapping.projectId } });
      if (!profile || profile.projectId !== mapping.projectId || profile.providerType !== "local" || !project || project.path !== envelope.plan.deploymentPath) fail("Review configuration project changed");
      const current = await tx.deploymentEnvValue.findMany({ where: { profileId: mapping.profileId } });
      if (current.length !== configuration.bindings.length) fail("Review configuration changed; review again");
      for (const binding of configuration.bindings) {
        const version = await tx.deploymentEnvValueVersion.findUnique({ where: { id: binding.versionId } });
        const value = current.find(item => item.component === binding.service && item.key === binding.key);
        if (!version || version.profileId !== mapping.profileId || version.component !== binding.service || version.key !== binding.key || version.version !== binding.version || version.state !== "active" || !value || value.version !== binding.version || value.value !== version.value) fail("Review configuration changed; review again");
      }
    }
    const host = await tx.vpsConfig.findUnique({ where: { id: envelope.host.id }, select: hostSelect });
    if (!host || JSON.stringify({ ...host, updatedAt: host.updatedAt.toISOString() }) !== JSON.stringify(envelope.host)) fail("Server configuration changed; review again");
    const collision = await tx.enrolledDeployment.findFirst({ where: { vpsConfigId: host.id, sourcePath: envelope.plan.deploymentPath } });
    if (collision) fail("Deployment path is already reserved");
    const proposalInput = JSON.parse(proposal.inputJson) as DeploymentProposalInput;
    const composeProject = `gcf_${hash(proposalId).slice(0,24)}`;
    const deployment = await tx.enrolledDeployment.create({ data: {
      name: proposalInput.workloadName, slug: `${proposalInput.workloadName}-${hash(proposalId).slice(0,16)}`, kind: "compose", managementMode: "managed", status: "pending", vpsConfigId: host.id,
      legacyProjectId: mapping?.projectId,
      sourcePath: envelope.plan.deploymentPath, composePath: `${envelope.plan.deploymentPath}/.groundcontrol/effective-compose.yml`,
      metadataJson: JSON.stringify({ composeProject, agentEnrollment: { proposalId, recipeHash: review.reviewHash, firstLaunchState: "pending" } }),
    } });
    const recipe = await tx.agentDeploymentRecipe.create({ data: { proposalId, reviewId: review.id, deploymentId: deployment.id, vpsConfigId: host.id, deploymentPath: envelope.plan.deploymentPath, userId, recipeJson: review.reviewJson, recipeHash: review.reviewHash } });
    await tx.agentDeploymentProposal.update({ where: { id: proposalId }, data: { status: "accepted", reviewedAt: new Date() } });
    return { deploymentId: deployment.id, recipeId: recipe.id, status: "pending", requiresResourceConsent: true, notice: "Deployment reserved; separate resource permission and first launch are required." };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
