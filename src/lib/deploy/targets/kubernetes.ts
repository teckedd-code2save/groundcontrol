/**
 * DeployTarget adapter for k3s Kubernetes deployments.
 *
 * Type: "k3s"
 */

import type { Project, DeploymentTarget } from "@prisma/client";
import type {
  DeployContext,
  DeployTarget,
  DeployBuildResult,
  DeployResult,
} from "./types";
import { execOnVps, shQuote } from "@/lib/vps";
import {
  generateDeploymentYaml,
  generateServiceYaml,
  generateIngressYaml,
} from "@/lib/k8s/manifests";
import {
  runKubectl,
  getIngressHost,
  getServiceUrl,
  getKubectlPrefix,
} from "@/lib/k8s/kubectl";

export interface K3sTargetConfig {
  namespace?: string;
  image?: string;
  replicas?: number;
  port?: number;
  ingressClass?: "traefik" | "caddy";
  serviceType?: "ClusterIP" | "LoadBalancer";
}

export function createK3sTarget(
  project: Project,
  target: DeploymentTarget
): DeployTarget {
  const config = parseK3sConfig(target.configJson);
  const namespace = config.namespace || `gc-${project.slug}`;
  const port = config.port || 80;
  const replicas = config.replicas || 1;
  const ingressClass = config.ingressClass || "traefik";
  const serviceType = config.serviceType || "ClusterIP";

  return {
    type: "k3s",

    async prepare(ctx: DeployContext) {
      ctx.log(`[k3s] preparing namespace ${namespace}`);

      const prefix = getKubectlPrefix();
      const dryRun = await execOnVps(
        `${prefix} kubectl create namespace ${shQuote(
          namespace
        )} --dry-run=client -o yaml`,
        ctx.vps
      );
      if (dryRun.code !== 0) {
        throw new Error(dryRun.stderr || "namespace dry-run failed");
      }

      await runKubectl(dryRun.stdout, ctx.vps);
    },

    async build(project, ctx): Promise<DeployBuildResult> {
      if (config.image) {
        ctx.log(`[k3s] using configured image ${config.image}`);
        return { imageTag: config.image };
      }

      if (project.dockerfile || project.category === "docker") {
        return buildDockerImage(project, ctx);
      }

      if (project.repoUrl) {
        return buildRepoImage(project, ctx);
      }

      ctx.log(
        `[k3s] no build configured; deploy will use image from config or default tag`
      );
      return {};
    },

    async deploy(project, _deployment, ctx): Promise<DeployResult> {
      ctx.log(`[k3s] deploying ${project.slug}`);

      const image = config.image || `gc-${project.slug}:latest`;
      const env = parseEnv(project.envVars);

      const deploymentYaml = generateDeploymentYaml({
        name: project.slug,
        namespace,
        image,
        replicas,
        port,
        env,
      });

      const serviceYaml = generateServiceYaml({
        name: project.slug,
        namespace,
        port,
        serviceType,
      });

      const host = project.domain || `${project.slug}.local`;
      const ingressYaml = generateIngressYaml({
        name: project.slug,
        namespace,
        host,
        serviceName: project.slug,
        port,
        ingressClass,
      });

      await runKubectl(deploymentYaml, ctx.vps);
      await runKubectl(serviceYaml, ctx.vps);
      await runKubectl(ingressYaml, ctx.vps);

      const rollout = await runKubectl(
        `rollout status deployment/${shQuote(
          project.slug
        )} -n ${shQuote(namespace)} --timeout=120s`,
        ctx.vps
      );
      if (rollout.code !== 0) {
        throw new Error(rollout.stderr || "k3s rollout failed");
      }

      const publicUrl = project.domain ? `https://${project.domain}` : undefined;
      let previewUrl: string | undefined;

      if (serviceType === "LoadBalancer") {
        const lbUrl = await getServiceUrl(namespace, project.slug, ctx.vps);
        if (lbUrl) previewUrl = lbUrl;
      }

      const ingressHost = await getIngressHost(namespace, project.slug, ctx.vps);
      if (ingressHost) {
        previewUrl = `http://${ingressHost}`;
      }

      return { publicUrl, previewUrl };
    },

    async rollback(_deployment, ctx) {
      ctx.log(`[k3s] rolling back ${project.slug}`);
      await runKubectl(
        `rollout undo deployment/${shQuote(
          project.slug
        )} -n ${shQuote(namespace)}`,
        ctx.vps
      );
    },

    async destroy(project, ctx) {
      ctx.log(`[k3s] destroying ${project.slug}`);
      await runKubectl(
        `delete namespace ${shQuote(namespace)} --cascade=background`,
        ctx.vps
      );
    },
  };
}

function parseK3sConfig(configJson: string): K3sTargetConfig {
  try {
    return JSON.parse(configJson || "{}") as K3sTargetConfig;
  } catch {
    return {};
  }
}

function parseEnv(envVars?: string | null): Record<string, string> {
  try {
    return envVars ? (JSON.parse(envVars) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function buildDockerImage(
  project: Project,
  ctx: DeployContext
): Promise<DeployBuildResult> {
  const workingDir = project.path || `/opt/${project.slug}`;
  const tag = `gc-${project.slug}:latest`;
  const dockerfile = project.dockerfile || "Dockerfile";

  ctx.log(`[k3s] building docker image ${tag}`);

  const result = await execOnVps(
    `cd ${shQuote(workingDir)} && docker build -f ${shQuote(
      dockerfile
    )} -t ${shQuote(tag)} .`,
    ctx.vps
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || "docker build failed");
  }

  await importImageToK3s(tag, ctx);

  return { imageTag: tag };
}

async function buildRepoImage(
  project: Project,
  ctx: DeployContext
): Promise<DeployBuildResult> {
  const workingDir = project.path || `/opt/${project.slug}`;
  const tag = `gc-${project.slug}:latest`;

  await cloneOrPull(project, workingDir, ctx);

  const hasDockerfile = await execOnVps(
    `test -f ${shQuote(`${workingDir}/Dockerfile`)} && echo yes || echo no`,
    ctx.vps
  );

  if (hasDockerfile.stdout.trim() === "yes") {
    ctx.log(`[k3s] building repo image ${tag}`);
    const result = await execOnVps(
      `cd ${shQuote(workingDir)} && docker build -t ${shQuote(tag)} .`,
      ctx.vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "docker build failed");
    }

    await importImageToK3s(tag, ctx);
    return { imageTag: tag };
  }

  ctx.log(`[k3s] no Dockerfile in repo; skipping image build`);
  return {};
}

async function importImageToK3s(tag: string, ctx: DeployContext) {
  const importResult = await execOnVps(
    `docker save ${shQuote(tag)} | k3s ctr -n k8s.io image import -`,
    ctx.vps
  );
  if (importResult.code !== 0) {
    ctx.log(
      `[k3s] warning: could not import image into containerd: ${importResult.stderr}`
    );
  }
}

async function cloneOrPull(
  project: Project,
  workingDir: string,
  ctx: DeployContext
) {
  const hasGit = await execOnVps(
    `test -d ${shQuote(`${workingDir}/.git`)} && echo yes || echo no`,
    ctx.vps
  );

  if (hasGit.stdout.trim() === "yes") {
    ctx.log(`[k3s] pulling latest source`);
    const result = await execOnVps(
      `cd ${shQuote(workingDir)} && git pull`,
      ctx.vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "git pull failed");
    }
  } else {
    ctx.log(`[k3s] cloning ${project.repoUrl}`);
    const result = await execOnVps(
      `rm -rf ${shQuote(workingDir)} && git clone --depth 1 ${shQuote(
        project.repoUrl!
      )} ${shQuote(workingDir)}`,
      ctx.vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "git clone failed");
    }
  }
}


