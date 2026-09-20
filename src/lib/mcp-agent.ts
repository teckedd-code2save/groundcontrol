import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { prisma } from "@/lib/prisma";
import { getDockerContainers, type VpsConnection } from "@/lib/vps";
import { inspectDeploymentEnvKeyPresence } from "@/lib/env-management";
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
  outputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
};


const DEPLOYMENT_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    slug: { type: "string" },
    kind: { type: "string" },
    managementMode: { type: "string" },
    status: { type: "string" },
    updatedAt: { type: "string" },
  },
  required: ["id", "name", "slug", "kind", "managementMode", "status", "updatedAt"],
  additionalProperties: false,
} as const;

const OPERATION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    deploymentId: { type: "integer" },
    type: { type: "string" },
    status: { type: "string" },
    idempotencyKey: { type: "string" },
    attempts: { type: "integer" },
    result: {},
    evidence: {},
    error: { anyOf: [{ type: "string" }, { type: "null" }] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    startedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
    finishedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: [
    "id",
    "deploymentId",
    "type",
    "status",
    "idempotencyKey",
    "attempts",
    "result",
    "evidence",
    "error",
    "createdAt",
    "updatedAt",
    "startedAt",
    "finishedAt",
  ],
  additionalProperties: false,
} as const;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "deployment.list",
    title: "List deployments",
    description: "List only the GroundControl deployments this agent has been granted access to.",
    requiredScope: "deployment:read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { deployments: { type: "array", items: DEPLOYMENT_SUMMARY_SCHEMA } },
      required: ["deployments"],
      additionalProperties: false,
    },
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
    outputSchema: {
      type: "object",
      properties: {
        deployment: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            slug: { type: "string" },
            kind: { type: "string" },
            managementMode: { type: "string" },
            status: { type: "string" },
            sourcePath: { anyOf: [{ type: "string" }, { type: "null" }] },
            composePath: { anyOf: [{ type: "string" }, { type: "null" }] },
            containerName: { anyOf: [{ type: "string" }, { type: "null" }] },
            project: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
            target: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
            source: { type: "object", additionalProperties: true },
            publicUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
            recentReleases: { type: "array", items: { type: "object", additionalProperties: true } },
            updatedAt: { type: "string" },
          },
          required: ["id", "name", "slug", "kind", "managementMode", "status", "source", "publicUrl", "recentReleases", "updatedAt"],
          additionalProperties: false,
        },
      },
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
    outputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string" },
        logs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              projectSlug: { type: "string" },
              status: { type: "string" },
              branch: { type: "string" },
              commitSha: { anyOf: [{ type: "string" }, { type: "null" }] },
              output: { anyOf: [{ type: "string" }, { type: "null" }] },
              error: { anyOf: [{ type: "string" }, { type: "null" }] },
              durationMs: { anyOf: [{ type: "integer" }, { type: "null" }] },
              createdAt: { type: "string" },
              updatedAt: { type: "string" },
            },
            required: ["id", "projectSlug", "status", "branch", "commitSha", "output", "error", "durationMs", "createdAt", "updatedAt"],
            additionalProperties: false,
          },
        },
      },
      required: ["deployment", "logs"],
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
    outputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string" },
        runtime: {
          type: "object",
          properties: {
            healthy: { type: "boolean" },
            containers: { type: "array", items: { type: "object", additionalProperties: true } },
          },
          required: ["healthy", "containers"],
          additionalProperties: false,
        },
        public: { type: "object", additionalProperties: true },
        healthy: { type: "boolean" },
      },
      required: ["deployment", "runtime", "public", "healthy"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "deployment.config.check",
    title: "Check deployment configuration",
    description: "Check whether explicitly named environment keys are configured for an approved deployment without returning any secret values. Returns configured, missing, or unmanaged status per requested key.",
    requiredScope: "deployment:read",
    inputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string", description: "Deployment slug or numeric id." },
        keys: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          uniqueItems: true,
          items: {
            type: "string",
            pattern: "^[A-Za-z_][A-Za-z0-9_]{0,127}$",
          },
          description: "Exact environment variable names to check. Values are never returned.",
        },
        environment: {
          type: "string",
          maxLength: 80,
          description: "Optional GroundControl environment slug such as production or staging.",
        },
      },
      required: ["deployment", "keys"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string" },
        profile: {
          anyOf: [
            {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                slug: { type: "string" },
                providerType: { type: "string" },
                status: { type: "string" },
                lastSyncedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
                lastError: { anyOf: [{ type: "string" }, { type: "null" }] },
              },
              required: ["id", "name", "slug", "providerType", "status", "lastSyncedAt", "lastError"],
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
        checks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              state: { type: "string", enum: ["configured", "missing", "unmanaged"] },
              configured: { type: "boolean" },
              declared: { type: "boolean" },
              matches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    component: { anyOf: [{ type: "string" }, { type: "null" }] },
                    required: { type: "boolean" },
                    configured: { type: "boolean" },
                  },
                  required: ["component", "required", "configured"],
                  additionalProperties: false,
                },
              },
            },
            required: ["key", "state", "configured", "declared", "matches"],
            additionalProperties: false,
          },
        },
      },
      required: ["deployment", "profile", "checks"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "deployment.source.deploy",
    title: "Build and deploy linked source",
    description: "Queue a durable deployment that syncs a linked GitHub source branch through the GroundControl GitHub App, builds on the target host, recreates the Compose workload, and verifies it without relying on GitHub Actions.",
    requiredScope: "deployment:redeploy",
    inputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string", description: "Deployment slug or numeric id." },
        branch: { type: "string", minLength: 1, maxLength: 200, description: "Optional GitHub branch. Defaults to the linked repository default branch." },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 160, description: "Stable unique key. Reusing it returns the original operation instead of deploying twice." },
        reason: { type: "string", maxLength: 500, description: "Short operational reason for the source deployment." },
      },
      required: ["deployment", "idempotencyKey"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        operation: OPERATION_SCHEMA,
        reused: { type: "boolean" },
      },
      required: ["operation", "reused"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
    outputSchema: {
      type: "object",
      properties: {
        operation: OPERATION_SCHEMA,
        reused: { type: "boolean" },
      },
      required: ["operation", "reused"],
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
    outputSchema: {
      type: "object",
      properties: { operation: OPERATION_SCHEMA },
      required: ["operation"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

export function toolDefinitionsForScopes(scopes?: Set<string>) {
  const visible = scopes
    ? TOOL_DEFINITIONS.filter((tool) => scopes.has(tool.requiredScope))
    : TOOL_DEFINITIONS;

  return visible.map(({ requiredScope, ...tool }) => {
    const securitySchemes = [{ type: "oauth2" as const, scopes: [requiredScope] }];
    return {
      ...tool,
      securitySchemes,
      _meta: {
        securitySchemes,
      },
    };
  });
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

  if (name === "deployment.config.check") {
    const deployment = await allowedDeployment(context, args.deployment);
    if (!deployment.legacyProject) {
      throw new Error("This deployment does not have a managed GroundControl environment profile.");
    }

    const requestedKeys = Array.isArray(args.keys)
      ? Array.from(new Set(args.keys.map((key) => String(key).trim())))
      : [];
    if (
      requestedKeys.length < 1 ||
      requestedKeys.length > 25 ||
      requestedKeys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))
    ) {
      throw new Error("Provide 1 to 25 valid environment variable names.");
    }

    const environment = typeof args.environment === "string" && args.environment.trim()
      ? args.environment.trim()
      : undefined;
    const status = await inspectDeploymentEnvKeyPresence(
      deployment.legacyProject,
      requestedKeys,
      environment
    );

    return {
      deployment: deployment.slug,
      profile: status.profile,
      checks: status.checks,
    };
  }

  if (name === "deployment.source.deploy") {
    const deployment = await allowedDeployment(context, args.deployment);
    if (deployment.managementMode !== "managed") {
      throw new Error("Source deployment requires a GroundControl-managed deployment.");
    }
    if (!deployment.legacyProject) {
      throw new Error("This deployment does not have a managed GroundControl project.");
    }
    const idempotencyKey = String(args.idempotencyKey || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new Error("idempotencyKey must be between 8 and 160 characters");
    }
    const branch = typeof args.branch === "string" ? args.branch.trim() : "";
    if (branch.length > 200) throw new Error("branch must be 200 characters or fewer");
    const existing = await prisma.agentOperation.findUnique({
      where: { grantId_idempotencyKey: { grantId: context.grant.id, idempotencyKey } },
    });
    if (existing) return { operation: serializeOperation(existing), reused: true };

    const operation = await prisma.agentOperation.create({
      data: {
        grantId: context.grant.id,
        deploymentId: deployment.id,
        type: "deployment.source.deploy",
        idempotencyKey,
        inputJson: JSON.stringify({
          branch: branch || undefined,
          reason: String(args.reason || "").trim().slice(0, 500),
        }),
      },
    });
    return { operation: serializeOperation(operation), reused: false };
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
