import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { prisma } from "@/lib/prisma";
import { getDockerContainers, type VpsConnection } from "@/lib/vps";
import {
  authenticateAccessToken,
  type OAuthScope,
  requireTokenScope,
} from "@/lib/oauth";

export type AgentAccessContext = Awaited<ReturnType<typeof authenticateAccessToken>>;

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  requiredScope: OAuthScope;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "deployment.list",
    title: "List deployments",
    description: "List only the GroundControl deployments this agent has been granted access to.",
    requiredScope: "deployment:read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "deployment.inspect",
    title: "Inspect deployment",
    description: "Inspect deployment identity, source, runtime target, recent releases, and recorded public endpoint without exposing secrets.",
    requiredScope: "deployment:read",
    inputSchema: {
      type: "object",
      properties: { deployment: { type: "string", description: "Deployment slug or numeric id." } },
      required: ["deployment"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "deployment.logs",
    title: "Read deployment evidence",
    description: "Read recent GroundControl deployment execution evidence for an approved workload.",
    requiredScope: "deployment:logs",
    inputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string", description: "Deployment slug or numeric id." },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["deployment"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "deployment.health",
    title: "Check deployment health",
    description: "Check approved deployment containers and, when safe, its recorded public HTTP endpoint.",
    requiredScope: "deployment:health",
    inputSchema: {
      type: "object",
      properties: { deployment: { type: "string", description: "Deployment slug or numeric id." } },
      required: ["deployment"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "deployment.redeploy",
    title: "Redeploy deployment",
    description: "Queue a durable GroundControl redeploy for an approved workload. Returns an operation id immediately; use operation.get to follow verification and evidence.",
    requiredScope: "deployment:redeploy",
    inputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string", description: "Deployment slug or numeric id." },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 160, description: "Stable unique key. Reusing it returns the original operation instead of redeploying twice." },
        reason: { type: "string", maxLength: 500, description: "Short operational reason for the redeploy." },
      },
      required: ["deployment", "idempotencyKey"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "operation.get",
    title: "Get operation",
    description: "Read the current state, result, verification evidence, and error for an operation created by this grant.",
    requiredScope: "operation:read",
    inputSchema: {
      type: "object",
      properties: { operationId: { type: "string", minLength: 8 } },
      required: ["operationId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

export function toolDefinitionsForScopes(scopes: Set<string>) {
  return TOOL_DEFINITIONS.filter((tool) => scopes.has(tool.requiredScope)).map(({ requiredScope: _scope, ...tool }) => tool);
}

function redactEvidenceText(value: string | null): string | null {
  if (!value) return value;
  return value
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
    .replace(/\b(password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*([^\s"'\x60]+)/gi, "$1=[REDACTED]");
}

function parseIdentifier(value: unknown) {
  const text = String(value || "").trim();
  if (!text) throw new Error("deployment is required");
  const id = Number(text);
  return { text, id: Number.isSafeInteger(id) && id > 0 ? id : null };
}

async function allowedDeployment(context: AgentAccessContext, value: unknown) {
  const identifier = parseIdentifier(value);
  if (!context.resources.length) throw new Error("This grant has no deployment resources.");
  const deployment = await prisma.enrolledDeployment.findFirst({
    where: {
      AND: [
        { id: { in: context.resources } },
        identifier.id ? { id: identifier.id } : { slug: identifier.text },
      ],
    },
    include: {
      projectGroup: { select: { id: true, name: true, slug: true } },
      vpsConfig: { select: { id: true, name: true, host: true, port: true, username: true, isLocal: true, authType: true, privateKey: true, password: true } },
      legacyProject: {
        include: {
          deployments: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              status: true,
              branch: true,
              commitSha: true,
              publicUrl: true,
              previewUrl: true,
              durationMs: true,
              createdAt: true,
              changedFields: true,
            },
          },
        },
      },
    },
  });
  if (!deployment) throw new Error("Deployment is not available to this agent.");
  return deployment;
}

function safeDeployment(deployment: Awaited<ReturnType<typeof allowedDeployment>>) {
  const latest = deployment.legacyProject?.deployments?.[0] || null;
  return {
    id: deployment.id,
    name: deployment.name,
    slug: deployment.slug,
    kind: deployment.kind,
    managementMode: deployment.managementMode,
    status: deployment.status,
    sourcePath: deployment.sourcePath,
    composePath: deployment.composePath,
    containerName: deployment.containerName,
    project: deployment.projectGroup,
    target: deployment.vpsConfig ? {
      id: deployment.vpsConfig.id,
      name: deployment.vpsConfig.name,
      host: deployment.vpsConfig.host,
      local: deployment.vpsConfig.isLocal,
    } : null,
    source: {
      repoUrl: deployment.legacyProject?.repoUrl || null,
      branch: latest?.branch || null,
      revision: latest?.commitSha || null,
    },
    publicUrl: latest?.publicUrl || latest?.previewUrl || (deployment.legacyProject?.domain ? `https://${deployment.legacyProject.domain}` : null),
    recentReleases: deployment.legacyProject?.deployments || [],
    updatedAt: deployment.updatedAt,
  };
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, "");
  if (normalized === "::1") return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(normalized);
}

async function probePublicUrl(value: string | null) {
  if (!value) return { checked: false, reason: "No public URL recorded" };
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isPrivateAddress(url.hostname) || url.hostname === "localhost") {
      return { checked: false, reason: "Public verification URL is not eligible for external probing" };
    }
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((address) => isPrivateAddress(address.address))) {
      return { checked: false, reason: "Public verification URL resolves to a private address" };
    }
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
    return {
      checked: true,
      url: url.toString(),
      status: response.status,
      healthy: response.status >= 200 && response.status < 400,
    };
  } catch (error) {
    return { checked: true, healthy: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function executeAgentTool(
  context: AgentAccessContext,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) throw new Error(`Unknown tool: ${name}`);
  requireTokenScope(context, definition.requiredScope);

  if (name === "deployment.list") {
    const deployments = await prisma.enrolledDeployment.findMany({
      where: { id: { in: context.resources } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, slug: true, kind: true, managementMode: true, status: true, updatedAt: true },
    });
    return { deployments };
  }

  if (name === "deployment.inspect") {
    return { deployment: safeDeployment(await allowedDeployment(context, args.deployment)) };
  }

  if (name === "deployment.logs") {
    const deployment = await allowedDeployment(context, args.deployment);
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));
    const slugs = Array.from(new Set([deployment.slug, deployment.legacyProject?.slug].filter((item): item is string => Boolean(item))));
    const logs = await prisma.deploymentLog.findMany({
      where: { projectSlug: { in: slugs } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, projectSlug: true, status: true, branch: true, commitSha: true, output: true, error: true, durationMs: true, createdAt: true, updatedAt: true },
    });
    return {
      deployment: deployment.slug,
      logs: logs.map((log) => ({
        ...log,
        output: redactEvidenceText(log.output),
        error: redactEvidenceText(log.error),
      })),
    };
  }

  if (name === "deployment.health") {
    const deployment = await allowedDeployment(context, args.deployment);
    const vps = deployment.vpsConfig as VpsConnection | null;
    const containers = vps ? await getDockerContainers(vps) : [];
    const prefixes = [deployment.containerName, deployment.legacyProject?.slug, deployment.slug].filter((item): item is string => Boolean(item));
    const matched = containers.filter((container) => prefixes.some((prefix) => container.name === prefix || container.name.startsWith(`${prefix}-`)));
    const publicUrl = safeDeployment(deployment).publicUrl;
    const publicProbe = await probePublicUrl(publicUrl);
    const runtimeHealthy = matched.length > 0 && matched.every((container) => container.state === "running");
    return {
      deployment: deployment.slug,
      runtime: {
        healthy: runtimeHealthy,
        containers: matched.map((container) => ({ name: container.name, image: container.image, state: container.state, status: container.status })),
      },
      public: publicProbe,
      healthy: runtimeHealthy && (publicProbe.checked ? Boolean(publicProbe.healthy) : true),
    };
  }

  if (name === "deployment.redeploy") {
    const deployment = await allowedDeployment(context, args.deployment);
    const idempotencyKey = String(args.idempotencyKey || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new Error("idempotencyKey must be between 8 and 160 characters");
    }
    const existing = await prisma.agentOperation.findUnique({
      where: { grantId_idempotencyKey: { grantId: context.grant.id, idempotencyKey } },
    });
    if (existing) return { operation: serializeOperation(existing), reused: true };

    const operation = await prisma.agentOperation.create({
      data: {
        grantId: context.grant.id,
        deploymentId: deployment.id,
        type: "deployment.redeploy",
        idempotencyKey,
        inputJson: JSON.stringify({ reason: String(args.reason || "").trim().slice(0, 500) }),
      },
    });
    return { operation: serializeOperation(operation), reused: false };
  }

  if (name === "operation.get") {
    const operationId = String(args.operationId || "").trim();
    const operation = await prisma.agentOperation.findFirst({
      where: { id: operationId, grantId: context.grant.id },
    });
    if (!operation) throw new Error("Operation not found for this agent grant");
    return { operation: serializeOperation(operation) };
  }

  throw new Error(`Tool not implemented: ${name}`);
}

function parseJson(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}

export function serializeOperation(operation: {
  id: string;
  deploymentId: number;
  type: string;
  status: string;
  idempotencyKey: string;
  resultJson: string | null;
  evidenceJson: string | null;
  error: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}) {
  return {
    id: operation.id,
    deploymentId: operation.deploymentId,
    type: operation.type,
    status: operation.status,
    idempotencyKey: operation.idempotencyKey,
    attempts: operation.attempts,
    result: parseJson(operation.resultJson),
    evidence: parseJson(operation.evidenceJson),
    error: operation.error,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
  };
}
