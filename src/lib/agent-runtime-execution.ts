import { getActiveAppDomainBinding, verifyActiveAppDomainBinding, type ActiveAppDomainBinding } from "./agent-app-domain-publish";
import { resolveFirstLaunchConfiguration, type FirstLaunchConfiguration } from "./agent-first-launch-config";
import { planAgentFirstDeploy } from "./agent-first-deploy-plan";
import type { ApprovedFirstDeployRecipe } from "./agent-first-deploy-execution";
import { claimAgentFirstLaunch, recordFirstLaunchEvidence, finishAgentFirstLaunch } from "./agent-first-launch";
import { claimAgentPublicSourceUpdate, recordPublicSourceUpdateEvidence, finishAgentPublicSourceUpdate } from "./agent-public-source-update";
import { executeAgentFirstDeploy, executeAgentPublicSourceUpdate } from "./agent-first-deploy-execution";
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

function runtimeConfigurationResolver(target: Target, recipe: ApprovedFirstDeployRecipe & { configuration?: FirstLaunchConfiguration }) {
  return async () => {
    if (!recipe.configuration) return {};
    const current = await prisma.enrolledDeployment.findUnique({ where: { id: target.deployment.id }, select: { legacyProjectId: true } });
    if (!current?.legacyProjectId || current.legacyProjectId !== target.deployment.legacyProjectId) throw new Error("Approved configuration project is no longer linked.");
    return resolveFirstLaunchConfiguration(target.operation.grant.userId, recipe.configuration, target.deployment.legacyProjectId, planAgentFirstDeploy(recipe).services);
  };
}

export async function executeRuntimeOperation(target: Target) {
  const { deployment, operation, input, vps } = target;
  const runtime = deploymentRuntime(deployment);
  if (operation.type === "deployment.first_launch") {
    const claimed = await claimAgentFirstLaunch(deployment.id, operation.id, String(input.recipeHash || ""), operation.grantId, target.operation.grant.userId);
    const resolveRuntimeConfiguration = runtimeConfigurationResolver(target, claimed.recipe);
    const result = await executeAgentFirstDeploy(claimed.recipe, claimed.vps, async evidence => {
      await resolveRuntimeConfiguration();
      await recordFirstLaunchEvidence(deployment.id, operation.id, operation.grantId, target.operation.grant.userId, evidence);
    }, { resolveRuntimeConfiguration });
    await finishAgentFirstLaunch(deployment.id, operation.id, result);
    return { ...result, ...(result.status === "uncertain" ? { uncertain: true } : {}), ...(result.hostMutation === "confirmed" ? { applied: true } : result.hostMutation === "none" ? { applied: false } : {}) };
  }
  if (operation.type === "deployment.source.deploy" && input.publicSourceRecipe === true) {
    const expectedDomain = input.appDomainBinding as ActiveAppDomainBinding | null | undefined;
    if (expectedDomain === undefined) throw new Error("Source update is missing its explicit domain snapshot; inspect and submit a new approved operation.");
    const checkDomainBinding = async () => {
      const current = await getActiveAppDomainBinding(operation.grant.userId, deployment.id);
      if (JSON.stringify(current) !== JSON.stringify(expectedDomain)) throw new Error("Approved application domain binding changed; inspect before recovery.");
    };
    await checkDomainBinding();
    const claimed = await claimAgentPublicSourceUpdate(deployment.id, operation.id, operation.grantId, operation.grant.userId);
    const resolveRuntimeConfiguration = runtimeConfigurationResolver(target, claimed.recipe);
    let result = await executeAgentPublicSourceUpdate(claimed.recipe, claimed.update, claimed.vps, async evidence => {
      await resolveRuntimeConfiguration();
      await checkDomainBinding();
      await recordPublicSourceUpdateEvidence(deployment.id, operation.id, operation.grantId, operation.grant.userId, evidence);
    }, { resolveRuntimeConfiguration });
    if (result.success && expectedDomain) {
      try {
        const publicHealth = await verifyActiveAppDomainBinding(operation.grant.userId, deployment.id, expectedDomain);
        if (!publicHealth.checked || !publicHealth.healthy) result = { ...result, success: false, status: "failed", publicVerified: false, error: "Application updated but the approved public HTTPS route, marker or health could not be verified. Inspect before recovery." };
        else result = { ...result, publicVerified: true };
      } catch {
        result = { ...result, success: false, status: "uncertain", publicVerified: false, error: "Application update public outcome could not be confirmed. Inspect before recovery; do not replay." };
      }
    }
    await finishAgentPublicSourceUpdate(deployment.id, operation.id, result);
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
