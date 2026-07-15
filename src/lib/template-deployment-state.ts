import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma";
import type { TemplateSourceResolution } from "./template-source";

export interface TemplateDnsRecord {
  recordId?: string;
  name?: string;
  content?: string;
}

export interface PersistTemplateDeploymentInput {
  slug: string;
  templateName: string;
  deployPath: string;
  composeProject: string;
  source: TemplateSourceResolution;
  domains: string[];
  composeYml: string;
  proxyConfig: string;
  proxyConfigPath: string;
  proxyOutput: unknown;
  dnsResult: unknown;
  tunnelConfigResult?: unknown;
  healthResults: unknown[];
  upOutput: unknown;
  manifest: string;
  tunnelId?: string | null;
  vpsConfigId?: number | null;
  durationMs?: number;
  status?: "success" | "degraded" | "failed";
  /** Project category: docker (default) or static. */
  category?: "docker" | "static" | "app";
  /** Deployment target type used for this template run. */
  targetType?: "compose" | "static";
  staticDir?: string | null;
}

export interface PersistTemplateDeploymentResult {
  projectId: number;
  targetId: number;
  deploymentId: number;
}

export type TemplateDeploymentPrismaClient = Pick<PrismaClient, "project" | "deploymentTarget" | "deployment">;

function isTemplateManagedTargetConfig(value: string | null | undefined): boolean {
  try {
    const parsed = JSON.parse(value || "{}") as { managedBy?: unknown };
    return parsed.managedBy === "template-deploy";
  } catch {
    return false;
  }
}

export async function persistTemplateDeployment(
  input: PersistTemplateDeploymentInput,
  client: TemplateDeploymentPrismaClient = defaultPrisma
): Promise<PersistTemplateDeploymentResult> {
  const primaryDomain = input.domains[0] || null;
  const publicUrl = primaryDomain ? `https://${primaryDomain}` : null;
  const status = input.status || "success";

  const category = input.category || "docker";
  const project = await client.project.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      name: humanizeSlug(input.slug),
      domain: primaryDomain,
      path: input.staticDir || input.deployPath,
      repoUrl: input.source.repoUrl || null,
      dockerCompose: category === "static" ? null : input.composeYml,
      caddyFile: input.proxyConfig || null,
      category,
      status,
      lastDeploy: new Date(),
      envVars: JSON.stringify({
        templateName: input.templateName,
        composeProject: input.composeProject,
        source: input.source,
        staticDir: input.staticDir || null,
      }),
    },
    update: {
      name: humanizeSlug(input.slug),
      domain: primaryDomain,
      path: input.staticDir || input.deployPath,
      repoUrl: input.source.repoUrl || null,
      dockerCompose: category === "static" ? null : input.composeYml,
      caddyFile: input.proxyConfig || null,
      category,
      status,
      lastDeploy: new Date(),
      envVars: JSON.stringify({
        templateName: input.templateName,
        composeProject: input.composeProject,
        source: input.source,
        staticDir: input.staticDir || null,
      }),
    },
  });

  const target = await resolveTemplateDeploymentTarget(
    client,
    input.vpsConfigId ?? null,
    input.targetType || "compose"
  );

  const deployment = await client.deployment.create({
    data: {
      projectId: project.id,
      targetId: target.id,
      status,
      branch: input.source.branch || input.source.requestedRef || "main",
      commitSha: input.source.commitSha || null,
      publicUrl,
      output: JSON.stringify({
        templateName: input.templateName,
        deployPath: input.deployPath,
        composeProject: input.composeProject,
        staticDir: input.staticDir || null,
        source: input.source,
        tunnelId: input.tunnelId || null,
        tunnelConfig: input.tunnelConfigResult ?? null,
        dns: input.dnsResult,
        proxy: input.proxyOutput,
        health: input.healthResults,
        upOutput: input.upOutput,
        manifest: safeJson(input.manifest),
      }),
      durationMs: input.durationMs ?? null,
    },
  });

  return {
    projectId: project.id,
    targetId: target.id,
    deploymentId: deployment.id,
  };
}

async function resolveTemplateDeploymentTarget(
  client: TemplateDeploymentPrismaClient,
  vpsConfigId: number | null,
  targetType: "compose" | "static" = "compose"
) {
  const typeFilter =
    targetType === "static"
      ? [{ type: "static" as const }]
      : [{ type: "compose" as const }, { type: "docker-compose" as const }];

  const activeTargets = await client.deploymentTarget.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: typeFilter },
        ...(vpsConfigId ? [{ OR: [{ vpsConfigId }, { vpsConfigId: null }] }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  const activeTarget = activeTargets.find((target) => !isTemplateManagedTargetConfig(target.configJson));
  if (activeTarget && !isTemplateManagedTargetConfig(activeTarget.configJson)) return activeTarget;

  const existingTargets = await client.deploymentTarget.findMany({
    where: {
      AND: [
        { OR: typeFilter },
        ...(vpsConfigId ? [{ OR: [{ vpsConfigId }, { vpsConfigId: null }] }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  const existing = existingTargets.find((target) => !isTemplateManagedTargetConfig(target.configJson));
  if (existing && !isTemplateManagedTargetConfig(existing.configJson)) return existing;

  if (targetType === "static") {
    return client.deploymentTarget.create({
      data: {
        name: "VPS Static Site",
        type: "static",
        vpsConfigId,
        configJson: JSON.stringify({
          managedBy: "groundcontrol",
        }),
        isActive: false,
      },
    });
  }

  return client.deploymentTarget.create({
    data: {
      name: "VPS Docker Compose",
      type: "compose",
      vpsConfigId,
      configJson: JSON.stringify({
        composeFile: "docker-compose.yml",
        projectPath: "",
        pullBeforeUp: true,
        managedBy: "groundcontrol",
      }),
      isActive: false,
    },
  });
}

export function normalizeDnsRecords(value: unknown): TemplateDnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const item = record as Record<string, unknown>;
    const normalized = {
      recordId: typeof item.recordId === "string" ? item.recordId : undefined,
      name: typeof item.name === "string" ? item.name : undefined,
      content: typeof item.content === "string" ? item.content : undefined,
    };
    return normalized.recordId || normalized.name || normalized.content ? [normalized] : [];
  });
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Template Deployment";
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
