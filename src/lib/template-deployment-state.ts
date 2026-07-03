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
}

export interface PersistTemplateDeploymentResult {
  projectId: number;
  targetId: number;
  deploymentId: number;
}

export type TemplateDeploymentPrismaClient = Pick<PrismaClient, "project" | "deploymentTarget" | "deployment">;

export async function persistTemplateDeployment(
  input: PersistTemplateDeploymentInput,
  client: TemplateDeploymentPrismaClient = defaultPrisma
): Promise<PersistTemplateDeploymentResult> {
  const primaryDomain = input.domains[0] || null;
  const publicUrl = primaryDomain ? `https://${primaryDomain}` : null;
  const dnsRecords = normalizeDnsRecords(input.dnsResult);
  const firstDns = dnsRecords[0];

  const project = await client.project.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      name: humanizeSlug(input.slug),
      domain: primaryDomain,
      path: input.deployPath,
      repoUrl: input.source.repoUrl || null,
      dockerCompose: input.composeYml,
      caddyFile: input.proxyConfig || null,
      category: "docker",
      status: "success",
      lastDeploy: new Date(),
      envVars: JSON.stringify({
        templateName: input.templateName,
        composeProject: input.composeProject,
        source: input.source,
      }),
    },
    update: {
      name: humanizeSlug(input.slug),
      domain: primaryDomain,
      path: input.deployPath,
      repoUrl: input.source.repoUrl || null,
      dockerCompose: input.composeYml,
      caddyFile: input.proxyConfig || null,
      category: "docker",
      status: "success",
      lastDeploy: new Date(),
      envVars: JSON.stringify({
        templateName: input.templateName,
        composeProject: input.composeProject,
        source: input.source,
      }),
    },
  });

  const targetName = `Template: ${input.slug}`;
  const targetConfig = {
    managedBy: "template-deploy",
    templateName: input.templateName,
    deploymentRoot: input.deployPath,
    composeProject: input.composeProject,
    source: input.source,
    domains: input.domains,
    proxyConfigPath: input.proxyConfigPath,
    tunnelId: input.tunnelId || null,
  };

  const existingTarget = await client.deploymentTarget.findFirst({
    where: { name: targetName, type: "docker-compose" },
    orderBy: { createdAt: "desc" },
  });

  const targetData = {
    name: targetName,
    type: "docker-compose",
    vpsConfigId: input.vpsConfigId ?? null,
    configJson: JSON.stringify(targetConfig),
    isActive: false,
    dnsRecordId: firstDns?.recordId || null,
    dnsRecordName: firstDns?.name || primaryDomain,
  };

  const target = existingTarget
    ? await client.deploymentTarget.update({
        where: { id: existingTarget.id },
        data: targetData,
      })
    : await client.deploymentTarget.create({ data: targetData });

  const deployment = await client.deployment.create({
    data: {
      projectId: project.id,
      targetId: target.id,
      status: "success",
      branch: input.source.branch || input.source.requestedRef || "main",
      commitSha: input.source.commitSha || null,
      publicUrl,
      output: JSON.stringify({
        templateName: input.templateName,
        deployPath: input.deployPath,
        composeProject: input.composeProject,
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
