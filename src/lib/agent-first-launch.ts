import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { jsonObject } from "./agent-runtime-capabilities";
import { prepareFirstDeployExecution, type ApprovedFirstDeployRecipe, type FirstDeployResult } from "./agent-first-deploy-execution";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function authorized(tx: Prisma.TransactionClient, deploymentId: number, operationId: string, grantId: number, userId: number) {
  const operation = await tx.agentOperation.findUnique({ where: { id: operationId }, include: { grant: { include: { user: true } } } });
  const g = operation?.grant;
  if (!operation || operation.type !== "deployment.first_launch" || operation.status !== "running" || operation.deploymentId !== deploymentId || operation.grantId !== grantId || !g || g.userId !== userId || g.revokedAt || g.user.role !== "admin" || g.user.forcePasswordChange || !g.scope.split(/\s+/).includes("deployment:redeploy") || !JSON.parse(g.resources || "[]").includes(deploymentId)) throw new Error("First launch is no longer authorized.");
  return operation;
}
export async function claimAgentFirstLaunch(deploymentId: number, operationId: string, expectedRecipeHash: string, grantId: number, userId: number) {
  if (process.env.GC_AGENT_ENROLLMENT_PROPOSALS !== "1") throw new Error("First launch is disabled.");
  return prisma.$transaction(async tx => {
    const operation = await authorized(tx, deploymentId, operationId, grantId, userId);
    if (jsonObject(operation.inputJson).recipeHash !== expectedRecipeHash) throw new Error("Operation recipe changed.");
    const saved = await tx.agentDeploymentRecipe.findUnique({ where: { deploymentId } });
    const deployment = await tx.enrolledDeployment.findUnique({ where: { id: deploymentId }, include: { vpsConfig: true } });
    if (!saved || saved.status !== "pending" || saved.launchOperationId || saved.userId !== userId || saved.recipeHash !== expectedRecipeHash || hash(saved.recipeJson) !== expectedRecipeHash || !deployment?.vpsConfig || deployment.vpsConfigId !== saved.vpsConfigId) throw new Error("The accepted recipe is unavailable, changed or already claimed. Inspect before recovery.");
    const envelope = JSON.parse(saved.recipeJson);
    const recipe = envelope.recipe as ApprovedFirstDeployRecipe;
    const prepared = prepareFirstDeployExecution(recipe);
    if (prepared.plan.deploymentPath !== saved.deploymentPath || recipe.proposalId !== saved.proposalId) throw new Error("Recipe reservation changed.");
    const host = deployment.vpsConfig;
    const snapshot = envelope.host;
    if (!snapshot || snapshot.id !== host.id || snapshot.host !== host.host || snapshot.port !== host.port || snapshot.username !== host.username || snapshot.isLocal !== host.isLocal || snapshot.authType !== host.authType || snapshot.updatedAt !== host.updatedAt.toISOString()) throw new Error("Approved host identity changed; request a fresh review.");
    const claimed = await tx.agentDeploymentRecipe.updateMany({ where: { id: saved.id, status: "pending", launchOperationId: null }, data: { status: "started", launchOperationId: operationId } });
    if (claimed.count !== 1) throw new Error("First launch was already claimed.");
    const metadata = jsonObject(deployment.metadataJson);
    await tx.enrolledDeployment.update({ where: { id: deploymentId }, data: { metadataJson: JSON.stringify({ ...metadata, agentEnrollment: { ...jsonObject(JSON.stringify(metadata.agentEnrollment)), firstLaunchState: "started" } }) } });
    return { recipe, vps: { ...host, privateKey: host.privateKey ?? undefined, password: host.password ?? undefined } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function recordFirstLaunchEvidence(deploymentId: number, operationId: string, grantId: number, userId: number, evidence: unknown) {
  if (process.env.GC_AGENT_ENROLLMENT_PROPOSALS !== "1") throw new Error("First launch was disabled before this phase.");
  await prisma.$transaction(async tx => {
    await authorized(tx, deploymentId, operationId, grantId, userId);
    const saved = await tx.agentDeploymentRecipe.findUnique({ where: { deploymentId } });
    if (!saved || saved.status !== "started" || saved.launchOperationId !== operationId) throw new Error("First launch reservation changed.");
    if (hash(saved.recipeJson) !== saved.recipeHash) throw new Error("Accepted recipe changed.");
    const snapshot = JSON.parse(saved.recipeJson).host;
    const host = await tx.vpsConfig.findUnique({ where: { id: saved.vpsConfigId } });
    if (!host || snapshot.updatedAt !== host.updatedAt.toISOString() || snapshot.host !== host.host || snapshot.port !== host.port || snapshot.username !== host.username || snapshot.isLocal !== host.isLocal || snapshot.authType !== host.authType) throw new Error("Approved host changed before this phase.");
    await tx.agentOperation.update({ where: { id: operationId }, data: { evidenceJson: JSON.stringify(evidence) } });
  });
}
export async function finishAgentFirstLaunch(deploymentId: number, operationId: string, result: FirstDeployResult) {
  await prisma.$transaction(async tx => {
    const saved = await tx.agentDeploymentRecipe.findUnique({ where: { deploymentId } });
    if (!saved || saved.status !== "started" || saved.launchOperationId !== operationId || result.deploymentPath !== saved.deploymentPath) throw new Error("First launch completion does not match its reservation.");
    const deployment = await tx.enrolledDeployment.findUniqueOrThrow({ where: { id: deploymentId } });
    const metadata = jsonObject(deployment.metadataJson);
    await tx.agentDeploymentRecipe.update({ where: { id: saved.id }, data: { status: result.status } });
    await tx.enrolledDeployment.update({ where: { id: deploymentId }, data: {
      status: result.success ? "active" : result.status,
      ...(result.success ? { sourcePath: result.deploymentPath, composePath: result.composePath } : {}),
      metadataJson: JSON.stringify({ ...metadata, composeProject: result.composeProject, agentEnrollment: { ...jsonObject(JSON.stringify(metadata.agentEnrollment)), firstLaunchState: result.status } }),
    } });
  });
}
