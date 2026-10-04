import { randomUUID } from "node:crypto";
import type { Project } from "@prisma/client";
import { parse, stringify } from "yaml";
import { prisma } from "./prisma";
import { execDetachedOnTarget, execOnTargetStrict } from "./host-exec";
import { buildManagedComposeInvocation, getDockerComposeCommand, shQuote, type VpsConnection } from "./vps";
import { buildDaytonaRelease } from "./daytona-release";
import { type ReleaseBuildPolicy, exactSourceRevision, repositoryPath } from "./daytona-release-plan";
import { syncGithubDeploymentSource } from "./github-source-deploy";
import { ensureGithubRegistryLogin } from "./github-registry";
import { reconcileManagedEnvironmentForRedeploy } from "./managed-environment-redeploy";
import { MANAGED_IMAGE_OVERRIDE_FILE, updateManagedImageOverride } from "./compose-management";
import { buildGuardedRollout, releaseImageOverride, snapshotReleaseEnvironment, restoreReleaseEnvironment } from "./daytona-rollout";
import { type DeploymentVerificationCheck } from "./compose-redeploy";
import { resolveTemplateDeploymentTarget } from "./template-deployment-state";

type Compose = { services: Record<string, { image?: string; restart?: string; [key: string]: unknown }>; [key: string]: unknown };

function privateCompose(content: string): Compose {
  try {
    const config = parse(content) as Compose;
    if (!config?.services || typeof config.services !== "object") throw new Error();
    return config;
  } catch { throw new Error("The host Compose configuration could not be parsed. Configuration values have been withheld."); }
}

export async function startDaytonaSourceDeploy(input: {
  deploymentId: number; project: Project;
  projectPath: string; composeFile: string; sourceRoot?: string; branch?: string; commitSha?: string;
  services?: string[]; policy: ReleaseBuildPolicy; vps: VpsConnection | null;
  logFile: string; lockDirectory: string; publicUrl: string | null; checks: DeploymentVerificationCheck[];
}) {
  if (input.sourceRoot) throw new Error("Remote releases require the host source path to be the repository root; select a repository-relative Compose file for a monorepo.");
  if (input.project.slug === "groundcontrol") throw new Error("Build GroundControl with the acceptance runner, then use the canonical installer upgrade path so SQLite is backed up while quiesced before migration. Generic workload rollout is blocked for GroundControl itself.");
  const releaseId = randomUUID();
  const directory = `${input.projectPath}/.groundcontrol/releases/${releaseId}`;
  const logFile = `/tmp/gc-redeploy-${input.project.slug}-${releaseId}.log`;
  const marker = `__GC_RELEASE_ID__=${releaseId}`;
  const host = async (command: string, stdin?: string) => {
    const result = await execOnTargetStrict(command, input.vps, undefined, stdin);
    // Commands resolving production configuration must never return their output in an error.
    if (result.code !== 0) throw new Error("Release preparation failed on the deployment host; running containers have not been replaced.");
    return result.stdout;
  };
  const save = (name: string, value: string) => host(`umask 077; cat > ${shQuote(`${directory}/${name}`)}`, value);
  const evidence = async (line: string) => { await host(`printf '%s\\n' ${shQuote(line)} >> ${shQuote(logFile)}`); };
  let releaseRecord: number | undefined;
  let logRecord: number | undefined;
  let previousCommit: string | undefined;
  let sourceChanged = false;
  try {
    await host(`umask 077; mkdir -p ${shQuote(directory)}; : > ${shQuote(logFile)}; chmod 600 ${shQuote(logFile)}; ln -sf ${shQuote(logFile)} ${shQuote(input.logFile)}`);
    await evidence(marker);
    const target = await resolveTemplateDeploymentTarget(prisma, input.vps?.id || null, "compose");
    const release = await prisma.deployment.create({ data: {
      projectId: input.project.id, targetId: target.id, status: "deploying", imageTag: "daytona:building",
      publicUrl: input.publicUrl, branch: input.branch || "main", output: marker,
    } });
    releaseRecord = release.id;
    logRecord = (await prisma.deploymentLog.create({ data: { projectSlug: input.project.slug, status: "running", output: marker } })).id;
    const relativeCompose = input.composeFile.slice(input.projectPath.length + 1);
    const artifact = await buildDaytonaRelease({
      deploymentId: input.deploymentId, branch: input.branch, commitSha: input.commitSha,
      composePath: repositoryPath(relativeCompose, input.sourceRoot || "."),
      policy: input.policy, services: input.services, evidence,
    });
    // No host source/configuration is changed until every remote image is published and the sandbox is deleted.
    const compose = await getDockerComposeCommand(input.vps, execOnTargetStrict);
    const cwd = `cd ${shQuote(input.projectPath)} && `;
    const invoke = (args: string) => cwd + buildManagedComposeInvocation(compose, args, input.composeFile);
    previousCommit = exactSourceRevision((await host(`${cwd}git rev-parse HEAD`)).trim());
    const oldConfig = privateCompose(await host(invoke("config")));
    const services = Object.keys(artifact.images);
    const previousImages: Record<string, string> = {};
    const previousOneShot: string[] = [];
    for (const service of services) {
      if (!oldConfig.services?.[service]) throw new Error(`No previous configuration for ${service}; enroll a baseline before remote releases.`);
      const ids = (await host(invoke(`ps -q --all ${shQuote(service)}`))).trim().split(/\s+/).filter(Boolean);
      if (ids.length !== 1) throw new Error(`Expected one existing container for ${service}; replicated or new services require a separate rollout.`);
      previousImages[service] = (await host(`docker inspect --format '{{.Image}}' ${shQuote(ids[0])}`)).trim();
      if (!/^sha256:[a-f0-9]{64}$/.test(previousImages[service])) throw new Error(`Cannot preserve previous image for ${service}.`);
      if (oldConfig.services[service].restart === "no") previousOneShot.push(service);
    }
    await save("previous.yml", stringify(oldConfig).replaceAll("$", "$$"));
    await save("previous-images.yml", releaseImageOverride(previousImages));
    await host(`${cwd}sh -c ${shQuote(snapshotReleaseEnvironment(directory))}`);
    await host(`${cwd}if [ -f ${shQuote(MANAGED_IMAGE_OVERRIDE_FILE)} ]; then cp ${shQuote(MANAGED_IMAGE_OVERRIDE_FILE)} ${shQuote(`${directory}/previous-override.yml`)}; touch ${shQuote(`${directory}/override-existed`)}; fi`);
    // Snapshot source/config before exact checkout. Database migrations are not reversed by an image rollback.
    sourceChanged = true;
    const source = await syncGithubDeploymentSource({ deploymentId: input.deploymentId, projectPath: input.projectPath, branch: artifact.branch, commitSha: artifact.commitSha, vps: input.vps });
    await reconcileManagedEnvironmentForRedeploy({ project: input.project, deployPath: input.projectPath, components: services, vps: input.vps });
    const nextConfig = privateCompose(await host(invoke("config")));
    let overrides = await host(`${cwd}cat ${shQuote(MANAGED_IMAGE_OVERRIDE_FILE)} 2>/dev/null || true`);
    for (const [service, image] of Object.entries(artifact.images)) {
      if (!nextConfig.services?.[service]) throw new Error(`Built service ${service} is missing from the host configuration.`);
      nextConfig.services[service].image = image;
      delete nextConfig.services[service].build;
      overrides = updateManagedImageOverride(overrides, service, image).content;
    }
    await save("next.yml", stringify(nextConfig).replaceAll("$", "$$"));
    await save("next-override.yml", overrides);
    await save("artifact.json", JSON.stringify({ releaseId, deploymentId: input.deploymentId, ...artifact }));
    await ensureGithubRegistryLogin(input.vps);
    await evidence(`${marker}\n[artifact] ${JSON.stringify(artifact)}`);
    await prisma.deployment.update({ where: { id: releaseRecord }, data: { imageTag: Object.values(artifact.images)[0], commitSha: artifact.commitSha, branch: artifact.branch } });
    const command = buildGuardedRollout({
      projectPath: input.projectPath, directory, composeCommand: compose, lockDirectory: input.lockDirectory,
      images: artifact.images, previousImages, services, previousCommit, previousOneShot,
      oneShot: services.filter(service => nextConfig.services[service].restart === "no"), checks: input.checks,
    });
    const launch = await execDetachedOnTarget(command, logFile, input.vps, { append: true });
    if (launch.code !== 0) throw new Error("Could not start the guarded rollout.");
    return { success: true, detached: true, releaseId, artifact, sourceSync: source, projectPath: input.projectPath, composePath: input.composeFile, output: "Daytona images published. Pull, health verification and automatic rollback are running on the host." };
  } catch (error) {
    if (sourceChanged && previousCommit) await host(`cd ${shQuote(input.projectPath)} && git reset --hard ${shQuote(previousCommit)} >/dev/null && sh -c ${shQuote(restoreReleaseEnvironment(directory))}`).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Daytona release failed.";
    await evidence(`${marker}\n[failure] ${message}\n__GC_REDEPLOY_STATUS__=failed:1`).catch(() => undefined);
    if (releaseRecord) await prisma.deployment.update({ where: { id: releaseRecord }, data: { status: "failed", error: message } });
    if (logRecord) await prisma.deploymentLog.update({ where: { id: logRecord }, data: { status: "failed", error: message } });
    throw error;
  }
}
