import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { jsonObject, runtimeIdentity } from "./agent-runtime-capabilities";
import { prepareAgentPublicSourceUpdate, type ApprovedFirstDeployRecipe, type FirstDeployResult } from "./agent-first-deploy-execution";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function inspectAuthorized(tx: Prisma.TransactionClient, deploymentId: number, operationId: string, grantId: number, userId: number) {
  if (process.env.GC_AGENT_ENROLLMENT_PROPOSALS !== "1") throw new Error("Public source updates are disabled.");
  const op = await tx.agentOperation.findUnique({ where: { id: operationId }, include: { grant: { include: { user: true } } } });
  const grant = op?.grant;
  if (!op || op.type !== "deployment.source.deploy" || op.status !== "running" || op.deploymentId !== deploymentId || op.grantId !== grantId || !grant || grant.userId !== userId || grant.revokedAt || grant.user.role !== "admin" || grant.user.forcePasswordChange || !grant.scope.split(/\s+/).includes("deployment:redeploy") || !JSON.parse(grant.resources).includes(deploymentId)) throw new Error("Public source update is no longer authorized.");
  const input = jsonObject(op.inputJson);
  if (input.publicSourceRecipe !== true || typeof input.commitSha !== "string" || !/^[a-f0-9]{40}$/.test(input.commitSha)) throw new Error("Public source update requires an exact approved commit SHA.");
  const saved = await tx.agentDeploymentRecipe.findUnique({ where: { deploymentId } });
  const deployment = await tx.enrolledDeployment.findUnique({ where: { id: deploymentId }, include: { vpsConfig: true, legacyProject: true } });
  if (!saved || saved.userId !== userId || saved.recipeHash !== input.recipeHash || hash(saved.recipeJson) !== saved.recipeHash || !deployment?.vpsConfig || saved.vpsConfigId !== deployment.vpsConfigId) throw new Error("Accepted source recipe or host changed.");
  if (input.runtimeIdentity !== runtimeIdentity(deployment)) throw new Error("Deployment changed after source update was approved.");
  const envelope = JSON.parse(saved.recipeJson);
  const host = deployment.vpsConfig, snapshot = envelope.host;
  if (!snapshot || snapshot.id !== host.id || snapshot.host !== host.host || snapshot.port !== host.port || snapshot.username !== host.username || snapshot.isLocal !== host.isLocal || snapshot.authType !== host.authType || snapshot.updatedAt !== host.updatedAt.toISOString()) throw new Error("Approved host configuration changed.");
  const recipe = envelope.recipe as ApprovedFirstDeployRecipe;
  const update = { deploymentId, operationId, commitSha: input.commitSha };
  const { prepared } = prepareAgentPublicSourceUpdate(recipe, update);
  return { saved, deployment, recipe, update, prepared, vps: { ...host, privateKey: host.privateKey ?? undefined, password: host.password ?? undefined } };
}
export async function claimAgentPublicSourceUpdate(deploymentId: number, operationId: string, grantId: number, userId: number) {
  return prisma.$transaction(async tx => {
    const state = await inspectAuthorized(tx, deploymentId, operationId, grantId, userId);
    if (state.saved.status !== "success") throw new Error("A launch/update is unresolved or already claimed; inspect before recovery.");
    const claimed = await tx.agentDeploymentRecipe.updateMany({ where: { id: state.saved.id, status: "success" }, data: { status: "updating" } });
    if (claimed.count !== 1) throw new Error("Another source update already claimed this workload.");
    const metadata = jsonObject(state.deployment.metadataJson);
    const enrollment = jsonObject(JSON.stringify(metadata.agentEnrollment));
    await tx.enrolledDeployment.update({ where: { id: deploymentId }, data: { metadataJson: JSON.stringify({ ...metadata, agentEnrollment: { ...enrollment, sourceUpdateState: "started", sourceUpdateOperationId: operationId } }) } });
    return state;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function recordPublicSourceUpdateEvidence(deploymentId: number, operationId: string, grantId: number, userId: number, evidence: unknown) {
  await prisma.$transaction(async tx => {
    const state = await inspectAuthorized(tx, deploymentId, operationId, grantId, userId);
    const enrollment = jsonObject(JSON.stringify(jsonObject(state.deployment.metadataJson).agentEnrollment));
    if (state.saved.status !== "updating" || enrollment.sourceUpdateOperationId !== operationId) throw new Error("Public source update reservation changed.");
    await tx.agentOperation.update({ where: { id: operationId }, data: { evidenceJson: JSON.stringify(evidence) } });
  });
}
export async function finishAgentPublicSourceUpdate(deploymentId: number, operationId: string, result: FirstDeployResult) {
  await prisma.$transaction(async tx => {
    const saved = await tx.agentDeploymentRecipe.findUnique({ where: { deploymentId } });
    const deployment = await tx.enrolledDeployment.findUniqueOrThrow({ where: { id: deploymentId } });
    const metadata = jsonObject(deployment.metadataJson), enrollment = jsonObject(JSON.stringify(metadata.agentEnrollment));
    const operation = await tx.agentOperation.findUniqueOrThrow({ where: { id: operationId } });
    const input = jsonObject(operation.inputJson);
    if (!saved || saved.status !== "updating" || enrollment.sourceUpdateOperationId !== operationId || operation.deploymentId !== deploymentId || input.commitSha !== result.commitSha) throw new Error("Source update completion does not match its reservation.");
    const { prepared } = prepareAgentPublicSourceUpdate(JSON.parse(saved.recipeJson).recipe, { deploymentId, operationId, commitSha: String(input.commitSha) });
    if (result.deploymentPath !== prepared.plan.deploymentPath || result.composePath !== prepared.composePath || result.composeProject !== prepared.composeProject) throw new Error("Source update result paths changed.");
    await tx.agentDeploymentRecipe.update({ where: { id: saved.id }, data: { status: result.success ? "success" : `update_${result.status}` } });
    await tx.enrolledDeployment.update({ where: { id: deploymentId }, data: {
      ...(result.success ? { sourcePath: result.deploymentPath, composePath: result.composePath, status: "active" } : { status: result.status }),
      metadataJson: JSON.stringify({ ...metadata, agentEnrollment: { ...enrollment, sourceUpdateState: result.status, ...(result.success ? { currentCommitSha: result.commitSha } : {}) } }),
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
