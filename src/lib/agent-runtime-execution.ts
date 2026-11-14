import { claimAgentFirstLaunch, recordFirstLaunchEvidence, finishAgentFirstLaunch } from "./agent-first-launch";
import { executeAgentFirstDeploy } from "./agent-first-deploy-execution";
import { redeployStandalone } from "./standalone-redeploy";
import type { agentOperationTarget } from "./agent-operation-target";
import { deploymentRuntime, staticRecipe } from "./agent-runtime-capabilities";
import { agentComposeCommand, runtimeHealth, probePublicUrl, overallHealth } from "./agent-health";
import { shQuote } from "./vps";
import { execOnTargetStrict, execOnWorkloadTarget } from "./host-exec";
import { prisma } from "./prisma";
import { syncGithubDeploymentSource } from "./github-source-deploy";
import { HttpError } from "./errors";

type Target = NonNullable<Awaited<ReturnType<typeof agentOperationTarget>>>;

export async function executeRuntimeOperation(target: Target) {
  const { deployment, operation, input, vps } = target;
  const runtime = deploymentRuntime(deployment);
  if (operation.type === "deployment.first_launch") {
    const claimed = await claimAgentFirstLaunch(deployment.id, operation.id, String(input.recipeHash || ""), operation.grantId, target.operation.grant.userId);
    const result = await executeAgentFirstDeploy(claimed.recipe, claimed.vps, evidence => recordFirstLaunchEvidence(deployment.id, operation.id, operation.grantId, target.operation.grant.userId, evidence));
    await finishAgentFirstLaunch(deployment.id, operation.id, result);
    return { ...result, ...(result.status === "uncertain" ? { uncertain: true } : {}), ...(result.hostMutation === "confirmed" ? { applied: true } : result.hostMutation === "none" ? { applied: false } : {}) };
  }
  if (operation.type === "deployment.restart") {
    const command = runtime === "container"
      ? `docker restart ${shQuote(deployment.containerName!)}`
      : await agentComposeCommand(deployment, vps, "restart");
    const result = await execOnWorkloadTarget(command, vps, undefined, undefined, { timeout: 120_000 });
    if (result.code !== 0) throw new HttpError("Container restart failed; inspect the runtime before retrying.", 500);
    const health = await runtimeHealth(deployment, vps);
    if (health.healthy !== true) return { success: false, error: "Restart was applied but runtime health was not confirmed.", applied: true, runtime: health };
    return { success: true, applied: true, runtime: health };
  }

  if (runtime === "container" && operation.type === "deployment.redeploy") return redeployStandalone(target);

  if (runtime !== "static") throw new HttpError("Unsupported runtime operation.", 409);
  const recipe = staticRecipe(deployment);
  const project = deployment.legacyProject;
  if (!recipe || !project) throw new HttpError("No safe static publish recipe is recorded.", 409);
  const latest = await prisma.deployment.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } });
  if (!latest) throw new HttpError("No static release target is recorded.", 409);
  const release = await prisma.deployment.create({ data: {
    projectId: project.id, targetId: latest.targetId, status: "running",
    branch: typeof input.branch === "string" ? input.branch : latest.branch,
    idempotencyKey: `agent:${operation.id}`,
  } });
  const started = Date.now();
  try {
    let revision = latest.commitSha;
    let branch = release.branch;
    if (operation.type === "deployment.source.deploy") {
      const source = await syncGithubDeploymentSource({ deploymentId: deployment.id, projectPath: recipe.sourcePath, branch: typeof input.branch === "string" ? input.branch : undefined, vps });
      revision = source.commitSha;
      branch = source.branch;
    }
    if (recipe.buildCommand) {
      const result = await execOnTargetStrict(`cd ${shQuote(recipe.sourcePath)} && ${recipe.buildCommand}`, vps, undefined, undefined, { timeout: 15 * 60_000 });
      if (result.code !== 0) throw new HttpError("Saved static build command failed. Published files were not changed.", 500);
    }
    const stage = `${recipe.staticDir}.gc-${operation.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    // Fully stage before touching the live directory. Never retry a failed swap automatically.
    const command = [
      "set -eu",
      `test -d ${shQuote(recipe.outputPath)}`,
      `test ! -e ${shQuote(stage)}`,
      `mkdir ${shQuote(stage)}`,
      `cp -Rp ${shQuote(`${recipe.outputPath}/.`)} ${shQuote(`${stage}/`)}`,
      `rm -rf ${shQuote(`${recipe.staticDir}.prev`)}`,
      `if [ -d ${shQuote(recipe.staticDir)} ]; then mv ${shQuote(recipe.staticDir)} ${shQuote(`${recipe.staticDir}.prev`)}; fi`,
      `if ! mv ${shQuote(stage)} ${shQuote(recipe.staticDir)}; then if [ -d ${shQuote(`${recipe.staticDir}.prev`)} ]; then mv ${shQuote(`${recipe.staticDir}.prev`)} ${shQuote(recipe.staticDir)}; fi; exit 1; fi`,
    ].join("\n");
    const publish = await execOnTargetStrict(command, vps, undefined, undefined, { timeout: 15 * 60_000 });
    if (publish.code !== 0) throw new HttpError("Static publish failed; inspect the document root and previous release before retrying.", 500);
    const publicUrl = latest.publicUrl || latest.previewUrl || (project.domain ? `https://${project.domain}` : null);
    const publicProbe = await probePublicUrl(publicUrl);
    const health = await runtimeHealth(deployment, vps);
    const healthy = overallHealth(health, publicProbe);
    const evidence = { applied: true, runtime: health, public: publicProbe, healthy, publicVerified: publicProbe.checked && publicProbe.healthy === true };
    await prisma.deployment.update({ where: { id: release.id }, data: {
      status: healthy === false ? "degraded" : "success", publicUrl, branch, commitSha: revision,
      durationMs: Date.now() - started, output: JSON.stringify(evidence),
    } });
    return { success: healthy !== false, ...evidence, releaseId: release.id, ...(healthy === false ? { error: "Files were published but public verification failed." } : {}) };
  } catch (error) {
    await prisma.deployment.update({ where: { id: release.id }, data: { status: "failed", error: error instanceof HttpError ? error.message : "Static operation failed; inspect before retrying.", durationMs: Date.now() - started } });
    throw error;
  }
}
