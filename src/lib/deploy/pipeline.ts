/**
 * Deployment pipeline orchestrator.
 *
 * Handles target selection, Deployment row lifecycle, adapter invocation,
 * optional custom domain provisioning, and optional quick-tunnel preview URLs.
 */

import { createHash } from "crypto";
import type { Project, DeploymentTarget } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveVps, execOnVps, shQuote } from "@/lib/vps";
import { createAlert } from "@/lib/alerts";
import {
  provisionCustomDomain,
  provisionK3sIngress,
  createQuickTunnel,
  destroyQuickTunnelByInfo,
} from "./cloudflare-links";
import { getK3sPreviewPort } from "@/lib/k8s/utils";
import { createAdapter } from "./targets";
import type { DeployContext, DeployResult } from "./targets/types";
import { runTerraformApply } from "@/lib/terraform/runner";
import type { TerraformOutput } from "@/lib/terraform/types";

const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;

export interface RunDeployOptions {
  projectId: number;
  targetId?: number;
  branch?: string;
  generatePreviewUrl?: boolean;
  subdomain?: string;
  zoneId?: string;
  proxied?: boolean;
  /** Runtime overrides merged into DeploymentTarget.configJson for this deploy only. */
  configOverrides?: Record<string, unknown>;
  /** Optional explicit idempotency key. Defaults to a hash of the deploy inputs. */
  idempotencyKey?: string;
}

export interface RunBuildOptions {
  projectId: number;
  targetId?: number;
  branch?: string;
}

export interface ProvisionInfraOptions {
  projectId: number;
  stackId: number;
}

export interface ProvisionInfraResult {
  projectId: number;
  stackId: number;
  outputs: Record<string, TerraformOutput>;
}

export async function provisionInfraForDeploy(
  options: ProvisionInfraOptions
): Promise<ProvisionInfraResult> {
  const { projectId, stackId } = options;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const stack = await prisma.terraformStack.findUnique({ where: { id: stackId } });
  if (!stack) {
    throw new Error(`Terraform stack ${stackId} not found`);
  }

  const result = await runTerraformApply(stack);
  if (!result.success) {
    throw new Error(`Terraform apply failed: ${result.stderr || result.stdout}`);
  }

  return {
    projectId: project.id,
    stackId: stack.id,
    outputs: result.outputs,
  };
}

function computeIdempotencyKey(options: RunDeployOptions): string {
  const { projectId, targetId, branch = "main", ...inputs } = options;
  const body = JSON.stringify({ projectId, targetId, branch, inputs });
  const hash = createHash("sha256").update(body).digest("hex");
  return `deploy:${projectId}:${targetId ?? "default"}:${branch}:${hash}`;
}

async function findRecentIdempotentDeployment(
  idempotencyKey: string
): Promise<{ id: number } | null> {
  const windowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  return prisma.deployment.findFirst({
    where: {
      idempotencyKey,
      createdAt: { gte: windowStart },
      status: { not: "failed" },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

async function destroyPreviousQuickTunnel(projectId: number): Promise<void> {
  const previous = await prisma.deployment.findFirst({
    where: {
      projectId,
      previewProcessInfo: { not: null },
      status: { not: "failed" },
    },
    orderBy: { createdAt: "desc" },
    select: { previewProcessInfo: true },
  });

  if (previous?.previewProcessInfo) {
    await destroyQuickTunnelByInfo(previous.previewProcessInfo);
  }
}

export async function runDeploy(options: RunDeployOptions): Promise<number> {
  const {
    projectId,
    targetId,
    branch = "main",
    generatePreviewUrl,
    subdomain,
    zoneId,
    proxied,
    configOverrides,
    idempotencyKey: explicitKey,
  } = options;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const idempotencyKey = explicitKey || computeIdempotencyKey(options);
  const existing = await findRecentIdempotentDeployment(idempotencyKey);
  if (existing) {
    console.log(
      `[pipeline] returning existing deployment ${existing.id} for idempotency key`
    );
    return existing.id;
  }

  const target = await mergeTargetConfig(await resolveTarget(targetId), configOverrides);

  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      targetId: target.id,
      status: "running",
      branch,
      idempotencyKey,
    },
  });

  const startTime = Date.now();
  const logBuffer: string[] = [];
  const vps = await getActiveVps();

  const ctx: DeployContext = {
    vps,
    env: parseEnv(project.envVars),
    secrets: {},
    log(chunk: string) {
      logBuffer.push(chunk);
    },
  };

  let effectiveTarget = target;
  if (target.type === "terraform") {
    const terraformCfg = JSON.parse(target.configJson || "{}") as {
      stackId?: number;
    };
    if (terraformCfg.stackId) {
      const stack = await prisma.terraformStack.findUnique({
        where: { id: terraformCfg.stackId },
      });
      if (!stack) {
        throw new Error(`Terraform stack ${terraformCfg.stackId} not found`);
      }
      const applyResult = await runTerraformApply(stack);
      if (!applyResult.success) {
        throw new Error(
          `Terraform apply failed: ${applyResult.stderr || applyResult.stdout}`
        );
      }
      const derivedType = applyResult.outputs.cloudrun_url ? "cloudrun" : "compose";
      effectiveTarget = {
        ...target,
        type: derivedType,
        configJson: JSON.stringify({
          ...terraformCfg,
          ...applyResult.outputs,
        }),
      };
      ctx.log(
        `[pipeline] terraform stack ${stack.id} applied; derived target type: ${derivedType}`
      );
    }
  }

  try {
    const adapter = createAdapter(project, effectiveTarget);

    ctx.log(`[pipeline] deploy ${deployment.id} for ${project.slug}`);
    await adapter.prepare(ctx);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "building" },
    });
    const buildResult = await adapter.build(project, ctx);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "deploying" },
    });
    const deployResult = await adapter.deploy(project, deployment, ctx);

    const result = await attachUrls(
      project,
      effectiveTarget,
      deployment,
      deployResult,
      ctx,
      { generatePreviewUrl, subdomain, zoneId, proxied }
    );

    const durationMs = Date.now() - startTime;
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "success",
        publicUrl: result.publicUrl ?? null,
        previewUrl: result.previewUrl ?? null,
        imageTag: buildResult.imageTag ?? null,
        output: logBuffer.join("\n"),
        durationMs,
      },
    });

    ctx.log(`[pipeline] deploy ${deployment.id} succeeded in ${durationMs}ms`);
    return deployment.id;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "failed",
        error: message,
        output: logBuffer.join("\n"),
        durationMs,
      },
    });

    await createAlert({
      title: `Deploy Failed: ${project.slug}`,
      message,
      severity: "error",
      source: "deploy",
    });

    throw err;
  }
}

/**
 * Run only the prepare + build phases for a project.
 * Useful for validating builds without deploying.
 */
export async function runBuild(options: RunBuildOptions): Promise<number> {
  const { projectId, targetId, branch = "main" } = options;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const target = await resolveTarget(targetId);

  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      targetId: target.id,
      status: "running",
      branch,
    },
  });

  const startTime = Date.now();
  const logBuffer: string[] = [];
  const vps = await getActiveVps();

  const ctx: DeployContext = {
    vps,
    env: parseEnv(project.envVars),
    secrets: {},
    log(chunk: string) {
      logBuffer.push(chunk);
    },
  };

  try {
    const adapter = createAdapter(project, target);

    ctx.log(`[pipeline] build ${deployment.id} for ${project.slug}`);
    await adapter.prepare(ctx);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "building" },
    });
    const buildResult = await adapter.build(project, ctx);

    const durationMs = Date.now() - startTime;
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "success",
        imageTag: buildResult.imageTag ?? null,
        output: logBuffer.join("\n"),
        durationMs,
      },
    });

    return deployment.id;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "failed",
        error: message,
        output: logBuffer.join("\n"),
        durationMs,
      },
    });

    await createAlert({
      title: `Build Failed: ${project.slug}`,
      message,
      severity: "error",
      source: "deploy",
    });

    throw err;
  }
}

/**
 * Roll back a previous deployment using its target adapter.
 */
export async function runRollback(deploymentId: number): Promise<void> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: { project: true, target: true },
  });
  if (!deployment) {
    throw new Error(`Deployment ${deploymentId} not found`);
  }

  // Best-effort cleanup of any ephemeral preview tunnel tied to this deployment.
  await destroyQuickTunnelByInfo(deployment.previewProcessInfo).catch(() => {});

  const { project, target } = deployment;
  const logBuffer: string[] = [];
  const vps = await getActiveVps();

  const ctx: DeployContext = {
    vps,
    env: parseEnv(project.envVars),
    secrets: {},
    log(chunk: string) {
      logBuffer.push(chunk);
    },
  };

  try {
    const adapter = createAdapter(project, target);
    ctx.log(`[pipeline] rolling back deployment ${deployment.id}`);
    await adapter.rollback(deployment, ctx);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "rolled_back",
        output: [deployment.output || "", logBuffer.join("\n")]
          .filter(Boolean)
          .join("\n"),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        error: [deployment.error || "", message].filter(Boolean).join("\n"),
        output: [deployment.output || "", logBuffer.join("\n")]
          .filter(Boolean)
          .join("\n"),
      },
    });

    await createAlert({
      title: `Rollback Failed: ${project.slug}`,
      message,
      severity: "error",
      source: "deploy",
    });

    throw err;
  }
}

function mergeTargetConfig(
  target: DeploymentTarget,
  overrides?: Record<string, unknown>
): DeploymentTarget {
  if (!overrides || Object.keys(overrides).length === 0) {
    return target;
  }

  let base: Record<string, unknown> = {};
  try {
    base = JSON.parse(target.configJson || "{}") as Record<string, unknown>;
  } catch {
    base = {};
  }

  return {
    ...target,
    configJson: JSON.stringify({ ...base, ...overrides }),
  };
}

async function resolveTarget(
  targetId?: number
): Promise<DeploymentTarget> {
  if (targetId) {
    const target = await prisma.deploymentTarget.findUnique({
      where: { id: targetId },
    });
    if (target) return target;
  }

  const active = await prisma.deploymentTarget.findFirst({
    where: { isActive: true },
  });
  if (active) return active;

  const anyTarget = await prisma.deploymentTarget.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (anyTarget) return anyTarget;

  // Synthetic fallback: create a default compose target on the active/only VPS.
  const vps = await getActiveVps();
  return prisma.deploymentTarget.create({
    data: {
      name: "Default Compose",
      type: "docker-compose",
      vpsConfigId: vps?.id ?? null,
      configJson: JSON.stringify({}),
      isActive: true,
    },
  });
}

interface UrlOptions {
  generatePreviewUrl?: boolean;
  subdomain?: string;
  zoneId?: string;
  proxied?: boolean;
}

async function attachUrls(
  project: Project,
  target: DeploymentTarget,
  deployment: { id: number },
  deployResult: DeployResult,
  ctx: DeployContext,
  options: UrlOptions
): Promise<DeployResult> {
  let publicUrl = deployResult.publicUrl;
  let previewUrl = deployResult.previewUrl;
  let previewProcessInfo: string | undefined;

  if (options.subdomain && options.zoneId) {
    if (target.type === "k3s") {
      const record = await provisionK3sIngress({
        subdomain: options.subdomain,
        zoneId: options.zoneId,
        vps: ctx.vps,
      });
      publicUrl = `https://${record.name}`;
      ctx.log(`[pipeline] k3s ingress DNS provisioned: ${publicUrl}`);
    } else {
      const targetHost = publicUrl
        ? stripProtocol(publicUrl)
        : project.domain || ctx.vps?.host;

      if (!targetHost) {
        throw new Error(
          "Cannot provision custom domain: no target host (publicUrl, project.domain, or VPS host) available"
        );
      }

      const record = await provisionCustomDomain({
        subdomain: options.subdomain,
        zoneId: options.zoneId,
        targetHost,
        proxied: options.proxied,
        recordId: target.dnsRecordId ?? undefined,
      });
      publicUrl = `https://${record.name}`;
      ctx.log(`[pipeline] custom domain provisioned: ${publicUrl}`);

      // Persist the record so subsequent deploys update instead of duplicate.
      await prisma.deploymentTarget.update({
        where: { id: target.id },
        data: {
          dnsRecordId: record.recordId,
          dnsRecordName: record.name,
        },
      });
    }
  }

  if (options.generatePreviewUrl) {
    // Clean up any previous project's quick tunnel before starting a new one.
    await destroyPreviousQuickTunnel(project.id).catch((err) => {
      ctx.log(
        `[pipeline] warning: failed to destroy previous quick tunnel: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });

    if (target.type === "k3s") {
      const port = await getK3sPreviewPort(project.slug, ctx.vps);
      if (port) {
        const tunnel = await createQuickTunnel(port, ctx.vps);
        previewUrl = tunnel.url;
        previewProcessInfo = JSON.stringify(tunnel.processInfo);
        ctx.log(`[pipeline] k3s preview tunnel ready: ${previewUrl} (port ${port})`);
      } else {
        ctx.log(`[pipeline] could not determine k3s preview port; skipping preview tunnel`);
      }
    } else {
      const port = await determineExposedPort(project, target, ctx);
      if (port) {
        const tunnel = await createQuickTunnel(port, ctx.vps);
        previewUrl = tunnel.url;
        previewProcessInfo = JSON.stringify(tunnel.processInfo);
        ctx.log(`[pipeline] preview tunnel ready: ${previewUrl}`);
      } else {
        ctx.log(`[pipeline] could not determine exposed port; skipping preview tunnel`);
      }
    }

    if (previewProcessInfo) {
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { previewProcessInfo },
      });
    }
  }

  return { publicUrl, previewUrl };
}

async function determineExposedPort(
  project: Project,
  target: DeploymentTarget,
  ctx: DeployContext
): Promise<number | null> {
  // 1. Explicit port in target config.
  try {
    const cfg = JSON.parse(target.configJson || "{}") as { port?: number };
    if (cfg.port) return cfg.port;
  } catch {
    // ignore invalid JSON
  }

  // 2. For compose targets, parse the first host port mapping from the compose file.
  if (target.type === "compose" || target.type === "docker-compose") {
    const vps = ctx.vps;
    const cfg = JSON.parse(target.configJson || "{}") as {
      projectPath?: string;
      composeFile?: string;
    };
    const composePath = cfg.projectPath || `/opt/${project.slug}`;
    const composeFile = cfg.composeFile || "docker-compose.yml";

    const cat = await execOnVps(
      `cat ${shQuote(`${composePath}/${composeFile}`)} 2>/dev/null || echo ""`,
      vps
    );
    const firstPort = cat.stdout.match(/["']?(\d+)["']?:\d+/);
    if (firstPort) {
      return parseInt(firstPort[1], 10);
    }

    // 3. Inspect running containers for the project and grab the first published port.
    const ps = await execOnVps(
      `docker ps --filter "name=${shQuote(project.slug)}" --format "{{.Ports}}" 2>/dev/null || echo ""`,
      vps
    );
    const runningPort = ps.stdout.match(/:(\d+)->/);
    if (runningPort) {
      return parseInt(runningPort[1], 10);
    }
  }

  return null;
}

function parseEnv(envVars?: string | null): Record<string, string> {
  try {
    return envVars ? (JSON.parse(envVars) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
