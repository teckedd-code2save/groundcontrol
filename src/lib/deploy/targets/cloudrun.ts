/**
 * DeployTarget adapter for Google Cloud Run.
 *
 * Type: "cloudrun"
 */

import type { Project, DeploymentTarget } from "@prisma/client";
import type {
  DeployContext,
  DeployTarget,
  DeployBuildResult,
  DeployResult,
} from "./types";
import { execOnVps, shQuote, type VpsConnection } from "@/lib/vps";
import { prisma } from "@/lib/prisma";
import { decryptCloudCredentials } from "@/lib/cloud/accounts";
import {
  getGcpAccessToken,
  cloudRunDeploy,
  cloudRunRollbackToPrevious,
  cloudRunDeleteService,
  listCloudRunServices,
} from "@/lib/cloud/gcp";

export interface CloudRunTargetConfig {
  projectId: string;
  region: string;
  serviceName?: string;
  cpu?: number | string;
  memory?: string;
  concurrency?: number;
  maxInstances?: number;
  minInstances?: number;
  /** Artifact Registry repository name (defaults to "groundcontrol"). */
  repository?: string;
}

async function loadGcpCredentials(target: DeploymentTarget): Promise<Record<string, unknown>> {
  if (!target.cloudProviderAccountId) {
    throw new Error("Cloud Run target is not linked to a cloud provider account");
  }

  const account = await prisma.cloudProviderAccount.findUnique({
    where: { id: target.cloudProviderAccountId },
  });
  if (!account) {
    throw new Error("Linked cloud provider account not found");
  }
  if (account.provider !== "gcp") {
    throw new Error(`Cloud Run requires a GCP account, got ${account.provider}`);
  }

  const credentials = decryptCloudCredentials(account.credentials);
  if (!credentials || typeof credentials !== "object") {
    throw new Error("Could not decrypt GCP credentials");
  }
  return credentials as Record<string, unknown>;
}

export function createCloudRunTarget(
  project: Project,
  target: DeploymentTarget
): DeployTarget {
  const config = parseCloudRunConfig(target.configJson);
  const serviceName = config.serviceName || project.slug;
  const repository = config.repository || "groundcontrol";

  return {
    type: "cloudrun",

    async prepare(ctx: DeployContext) {
      if (!config.projectId || !config.region) {
        throw new Error(
          "Cloud Run target requires projectId and region in config"
        );
      }

      const serviceAccountKey = await loadGcpCredentials(target);

      ctx.log(`[cloudrun] validating GCP credentials`);
      const accessToken = await getGcpAccessToken(serviceAccountKey);

      // Smoke-test the token by listing services for the configured project/region.
      await listCloudRunServices({
        accessToken,
        projectId: config.projectId,
        region: config.region,
      });

      ctx.log(`[cloudrun] GCP credentials OK`);
    },

    async build(project, ctx): Promise<DeployBuildResult> {
      const vps = requireVps(ctx.vps);
      const serviceAccountKey = await loadGcpCredentials(target);
      const accessToken = await getGcpAccessToken(serviceAccountKey);
      const workingDir = getWorkingDir(project);
      const dockerfile = project.dockerfile || "Dockerfile";
      const imageTag = `deploy-${Date.now()}`;
      const fullImageUri = getGarImageUri(
        config.region,
        config.projectId,
        repository,
        serviceName,
        imageTag
      );
      const registryHost = `${config.region}-docker.pkg.dev`;

      ctx.log(`[cloudrun] building image ${fullImageUri}`);

      await ensureWorkingDir(workingDir, vps);
      if (project.repoUrl) {
        await cloneOrPull(project, workingDir, ctx);
      }

      const hasDockerfile = await execOnVps(
        `test -f ${shQuote(`${workingDir}/${dockerfile}`)} && echo yes || echo no`,
        vps
      );
      if (hasDockerfile.stdout.trim() !== "yes") {
        throw new Error(
          `Cloud Run build requires a ${dockerfile} in ${workingDir}`
        );
      }

      await dockerLogin(registryHost, accessToken, vps, ctx);

      const buildxResult = await execOnVps(
        `cd ${shQuote(workingDir)} && docker buildx build --push -t ${shQuote(
          fullImageUri
        )} -f ${shQuote(dockerfile)} .`,
        vps
      );

      if (buildxResult.code !== 0) {
        ctx.log(`[cloudrun] buildx failed, falling back to docker build + push`);
        const fallback = await execOnVps(
          `cd ${shQuote(workingDir)} && docker build -t ${shQuote(
            fullImageUri
          )} -f ${shQuote(dockerfile)} . && docker push ${shQuote(
            fullImageUri
          )}`,
          vps
        );
        if (fallback.code !== 0) {
          throw new Error(fallback.stderr || "docker build/push failed");
        }
      }

      ctx.log(`[cloudrun] pushed ${fullImageUri}`);
      return { imageTag: fullImageUri };
    },

    async deploy(project, deployment, ctx): Promise<DeployResult> {
      const serviceAccountKey = await loadGcpCredentials(target);
      const accessToken = await getGcpAccessToken(serviceAccountKey);
      const image = deployment.imageTag || `gc-${project.slug}:latest`;

      ctx.log(`[cloudrun] deploying service ${serviceName}`);

      const result = await cloudRunDeploy({
        accessToken,
        projectId: config.projectId,
        region: config.region,
        serviceName,
        image,
        cpu: config.cpu,
        memory: config.memory,
        concurrency: config.concurrency,
        maxInstances: config.maxInstances,
        minInstances: config.minInstances,
        env: ctx.env,
      });

      ctx.log(`[cloudrun] service live at ${result.url}`);
      return { publicUrl: result.url };
    },

    async rollback(_deployment, ctx) {
      const serviceAccountKey = await loadGcpCredentials(target);
      const accessToken = await getGcpAccessToken(serviceAccountKey);
      ctx.log(`[cloudrun] rolling back ${serviceName}`);

      const result = await cloudRunRollbackToPrevious({
        accessToken,
        projectId: config.projectId,
        region: config.region,
        serviceName,
      });

      ctx.log(`[cloudrun] rolled back to ${result.revision} at ${result.url}`);
    },

    async destroy(project, ctx) {
      const serviceAccountKey = await loadGcpCredentials(target);
      const accessToken = await getGcpAccessToken(serviceAccountKey);
      ctx.log(`[cloudrun] destroying ${serviceName}`);

      try {
        await cloudRunDeleteService({
          accessToken,
          projectId: config.projectId,
          region: config.region,
          serviceName,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("404") || message.includes("not found")) {
          ctx.log(`[cloudrun] service already removed`);
          return;
        }
        throw err;
      }

      // Also drop the locally built image tag as a courtesy.
      const vps = ctx.vps;
      if (vps) {
        const imageUri = getGarImageUri(
          config.region,
          config.projectId,
          repository,
          serviceName,
          "latest"
        );
        await execOnVps(
          `docker rmi ${shQuote(imageUri)} 2>/dev/null || true`,
          vps
        );
      }
    },
  };
}

function parseCloudRunConfig(configJson: string): CloudRunTargetConfig {
  try {
    return JSON.parse(configJson || "{}") as CloudRunTargetConfig;
  } catch {
    return {} as CloudRunTargetConfig;
  }
}

function getWorkingDir(project: Project): string {
  return project.path || `/opt/${project.slug}`;
}

function getGarImageUri(
  region: string,
  projectId: string,
  repository: string,
  serviceName: string,
  tag: string
): string {
  return `${region}-docker.pkg.dev/${projectId}/${repository}/${serviceName}:${tag}`;
}

function requireVps(vps: VpsConnection | null | undefined): VpsConnection {
  if (!vps) {
    throw new Error("Cloud Run build requires an active VPS");
  }
  return vps;
}

async function ensureWorkingDir(workingDir: string, vps: VpsConnection) {
  await execOnVps(`mkdir -p ${shQuote(workingDir)}`, vps);
}

async function cloneOrPull(
  project: Project,
  workingDir: string,
  ctx: DeployContext
) {
  const vps = requireVps(ctx.vps);
  const hasGit = await execOnVps(
    `test -d ${shQuote(`${workingDir}/.git`)} && echo yes || echo no`,
    vps
  );

  if (hasGit.stdout.trim() === "yes") {
    ctx.log(`[cloudrun] pulling latest source`);
    const result = await execOnVps(
      `cd ${shQuote(workingDir)} && git pull`,
      vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "git pull failed");
    }
  } else {
    ctx.log(`[cloudrun] cloning ${project.repoUrl}`);
    const result = await execOnVps(
      `rm -rf ${shQuote(workingDir)} && git clone --depth 1 ${shQuote(
        project.repoUrl!
      )} ${shQuote(workingDir)}`,
      vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "git clone failed");
    }
  }
}

async function dockerLogin(
  registryHost: string,
  accessToken: string,
  vps: VpsConnection,
  ctx: DeployContext
) {
  const result = await execOnVps(
    `printf '%s\\n' ${shQuote(accessToken)} | docker login -u oauth2accesstoken --password-stdin https://${shQuote(
      registryHost
    )}`,
    vps
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || "docker login to Artifact Registry failed");
  }
  ctx.log(`[cloudrun] logged in to ${registryHost}`);
}
