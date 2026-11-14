import { agentEnrollmentEnabled, createAgentDeploymentProposal, getAgentDeploymentProposal } from "./agent-enrollment";
import { runtimeCapabilities, runtimeIdentity, requireRuntimeOperation, jsonObject } from "./agent-runtime-capabilities";
import { runtimeHealth, probePublicUrl, overallHealth } from "./agent-health";
import { prisma } from "@/lib/prisma";
import type { VpsConnection } from "@/lib/vps";
import { inspectDeploymentEnvKeyPresence } from "@/lib/env-management";
import { normalizeReleaseSha } from "@/lib/github-image-release";
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
    capabilities: { type: "object", additionalProperties: true },
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
    name: "deployment.proposal.create", title: "Request deployment review",
    description: "Persist an inert public GitHub Compose proposal for owner review. Does not fetch source, enroll, deploy, or grant access. Experimental.",
    requiredScope: "deployment:propose",
    inputSchema: { type: "object", additionalProperties: false, required: ["repositoryUrl", "revision", "runtime", "composePath", "workloadName", "idempotencyKey"], properties: {
      repositoryUrl: { type: "string", maxLength: 220 }, revision: { type: "string", pattern: "^[a-fA-F0-9]{40}$" }, runtime: { const: "compose" }, composePath: { type: "string", maxLength: 200 }, workloadName: { type: "string", maxLength: 48 }, serverId: { type: "integer", minimum: 1 }, idempotencyKey: { type: "string", minLength: 8, maxLength: 160 }
    } },
    outputSchema: { type: "object" }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "deployment.proposal.get", title: "Inspect deployment review request",
    description: "Read a proposal created under this grant. Approval and deployment are separate and not implemented by this tool.", requiredScope: "deployment:propose",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", maxLength: 128 } } },
    outputSchema: { type: "object" }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },

  {
    name: "deployment.list",
    title: "List deployments",
    description: "List only the GroundControl deployments this agent has been granted access to, including supported and authorized runtime operations.",
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
    description: "Inspect deployment identity, runtime capabilities, source, target, recent releases, and recorded public endpoint without exposing secrets.",
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
            capabilities: { type: "object", additionalProperties: true },
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
    description: "Check runtime-specific health and, when safe, the recorded public HTTP endpoint. Unchecked or unavailable evidence is unknown (null), including container health for static sites.",
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
            kind: { type: "string" },
            checked: { type: "boolean" },
            reason: { type: "string" },
            healthy: { type: ["boolean", "null"] },
            containers: { type: "array", items: { type: "object", additionalProperties: true } },
          },
          required: ["healthy", "containers"],
          additionalProperties: false,
        },
        public: { type: "object", additionalProperties: true },
        healthy: { type: ["boolean", "null"] },
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
    name: "deployment.first_launch", title: "Launch an owner-approved new workload",
    description: "Execute the exact owner-approved first-launch recipe for a newly enrolled deployment. Requires separate resource consent and explicit execution approval. Inspect capabilities for recipeHash. Does not alter recipe, host or grants; uncertain or completed launches cannot be replayed.",
    requiredScope: "deployment:redeploy",
    inputSchema: { type: "object", properties: {
      deployment: { type: ["integer", "string"] },
      recipeHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 160 },
    }, required: ["deployment", "recipeHash", "idempotencyKey"], additionalProperties: false },
    outputSchema: { type: "object", properties: { operation: OPERATION_SCHEMA, reused: { type: "boolean" } }, required: ["operation", "reused"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "deployment.source.deploy",
    title: "Build and deploy linked source",
    description: "Queue a durable deployment that syncs a linked GitHub source branch through the GroundControl GitHub App, builds on the enrolled host and deploys supported Compose or static workloads without relying on GitHub Actions.",
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
    description: "Queue a durable redeploy for a supported deployment with its saved Compose, static publish, or standalone recreate recipe. Inspect capabilities first. Returns an operation id immediately; use operation.get to follow verification and evidence.",
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
    name: "deployment.restart",
    title: "Restart deployment",
    description: "Restart the existing containers of an approved Compose or standalone deployment without pulling or replacing its image. Returns an operation id immediately; use operation.get to follow verification and evidence.",
    requiredScope: "deployment:redeploy",
    inputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string", description: "Deployment slug or numeric id." },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 160, description: "Stable unique key. Reusing it returns the original operation instead of restarting twice." },
        reason: { type: "string", maxLength: 500, description: "Short operational reason for the restart." },
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
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "deployment.build_publish",
    title: "Build and publish a release image",
    description: "Build an exact commit SHA, tag the built images with that SHA, push them to the container registry, and verify the artifacts (optionally running tests). Produces a durable build operation whose verified digests a later deployment.release can deploy. Unlike deployment.source.deploy (an in-place git-mode build) this yields a pushable, SHA-tagged, digest-verified image.",
    requiredScope: "deployment:redeploy",
    inputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string", description: "Deployment slug or numeric id." },
        commitSha: { type: "string", minLength: 40, maxLength: 64, description: "Exact 40-64 character commit SHA to build and publish." },
        branch: { type: "string", minLength: 1, maxLength: 200, description: "Optional GitHub branch to fetch the SHA from. Defaults to the linked repository default branch." },
        services: { type: "array", items: { type: "string" }, description: "Optional subset of buildable services to build. Defaults to all buildable services." },
        builder: { type: "string", enum: ["local", "buildkit", "docker-agentic"], description: "Build executor. buildkit (default) uses an isolated, resource-capped BuildKit builder on the host; docker-agentic builds in an ephemeral Docker Agentic Platform sandbox (fully off-host, amd64); local builds directly on the host (dev only)." },
        runTests: { type: "boolean", description: "Run the test command against the built image and record pass/fail (default false)." },
        testCommand: { type: "string", maxLength: 1000, description: "Explicit test command; otherwise the package.json test script is used." },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 160, description: "Stable unique key. Reusing it returns the original operation instead of building twice." },
        reason: { type: "string", maxLength: 500, description: "Short operational reason for the build." },
      },
      required: ["deployment", "commitSha", "idempotencyKey"],
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
    name: "deployment.release",
    title: "Release a built image by digest",
    description: "Deploy a previously built image (from deployment.build_publish) by its exact digest to an approved environment. Refuses to promote a build whose tests failed. Records the prior running digests as a rollback pair.",
    requiredScope: "deployment:redeploy",
    inputSchema: {
      type: "object",
      properties: {
        deployment: { type: "string", description: "Deployment slug or numeric id." },
        buildOperationId: { type: "string", minLength: 8, description: "The successful build operation whose digests to deploy." },
        expectedCurrentRevision: { type: "string", description: "Optional CAS guard: refuse the release if the deployment is not on this revision." },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 160, description: "Stable unique key. Reusing it returns the original operation instead of releasing twice." },
        reason: { type: "string", maxLength: 500, description: "Short operational reason for the release." },
      },
      required: ["deployment", "buildOperationId", "idempotencyKey"],
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
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
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
  const available = TOOL_DEFINITIONS.filter(tool => (tool.requiredScope !== "deployment:propose" && tool.name !== "deployment.first_launch") || agentEnrollmentEnabled());
  const visible = scopes
    ? available.filter((tool) => scopes.has(tool.requiredScope))
    : available;

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
        { id: { in: context.resources }, kind: { not: "source" } },
        identifier.id ? { id: identifier.id } : { slug: identifier.text },
      ],
    },
    include: {
      githubRepositories: { select: { githubRepositoryId: true } },
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

function safeDeployment(deployment: Awaited<ReturnType<typeof allowedDeployment>>, context: AgentAccessContext) {
  const latest = deployment.legacyProject?.deployments?.[0] || null;
  const metadata = jsonObject(deployment.metadataJson);
  let manualPublicUrl: string | null = null;
  try {
    const url = new URL(String(metadata.manualPublicUrl || ""));
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) manualPublicUrl = url.toString();
  } catch { /* Missing or invalid recorded endpoint. */ }
  return {
    capabilities: authorizedCapabilities(deployment, context),
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
    publicUrl: latest?.publicUrl || latest?.previewUrl || manualPublicUrl || (deployment.legacyProject?.domain ? `https://${deployment.legacyProject.domain}` : null),
    recentReleases: deployment.legacyProject?.deployments || [],
    updatedAt: deployment.updatedAt,
  };
}


export async function executeAgentTool(
  context: AgentAccessContext,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) throw new Error(`Unknown tool: ${name}`);
  requireTokenScope(context, definition.requiredScope);
  if (name === "deployment.proposal.create") return createAgentDeploymentProposal(context, args);
  if (name === "deployment.proposal.get") {
    if (Object.keys(args).some(key => key !== "id") || typeof args.id !== "string" || args.id.length > 128) throw new Error("Invalid proposal id");
    return getAgentDeploymentProposal(context, args.id);
  }

  if (name === "deployment.list") {
    const deployments = await prisma.enrolledDeployment.findMany({
      where: { id: { in: context.resources }, kind: { not: "source" } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: { legacyProject: true, githubRepositories: { select: { githubRepositoryId: true } } },
    });
    return { deployments: deployments.map((d) => ({ id: d.id, name: d.name, slug: d.slug, kind: d.kind, managementMode: d.managementMode, status: d.status, updatedAt: d.updatedAt, capabilities: authorizedCapabilities(d, context) })) };
  }

  if (name === "deployment.inspect") {
    return { deployment: safeDeployment(await allowedDeployment(context, args.deployment), context) };
  }

  if (name === "deployment.logs") {
    const deployment = await allowedDeployment(context, args.deployment);
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));
    const slugs = Array.from(new Set([deployment.slug, deployment.legacyProject?.slug].filter((item): item is string => Boolean(item))));
    const logs = deployment.kind === "static" && deployment.legacyProject
      ? (await prisma.deployment.findMany({
          where: { projectId: deployment.legacyProject.id }, orderBy: { createdAt: "desc" }, take: limit,
          select: { id: true, status: true, branch: true, commitSha: true, output: true, error: true, durationMs: true, createdAt: true, updatedAt: true },
        })).map((release) => ({ ...release, projectSlug: deployment.legacyProject!.slug }))
      : await prisma.deploymentLog.findMany({
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
    const runtime = await runtimeHealth(deployment, deployment.vpsConfig as VpsConnection | null);
    const publicProbe = await probePublicUrl(safeDeployment(deployment, context).publicUrl);
    return { deployment: deployment.slug, runtime, public: publicProbe, healthy: overallHealth(runtime, publicProbe) };
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

  if (name === "deployment.first_launch") {
    if (!agentEnrollmentEnabled()) throw new Error("First launch is not enabled.");
    if (Object.keys(args).some(key => !["deployment", "recipeHash", "idempotencyKey"].includes(key))) throw new Error("Unexpected first-launch input.");
    const deployment = await allowedDeployment(context, args.deployment);
    const recipeHash = String(args.recipeHash || "");
    const idempotencyKey = String(args.idempotencyKey || "").trim();
    if (!/^[a-f0-9]{64}$/.test(recipeHash) || runtimeCapabilities(deployment).firstLaunchRecipeHash !== recipeHash) throw new Error("Inspect the exact owner-approved recipe before launching.");
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) throw new Error("idempotencyKey must be 8–160 characters.");
    return enqueueOperation(context, deployment, name, idempotencyKey, { recipeHash });
  }

  if (name === "deployment.source.deploy") {
    const deployment = await allowedDeployment(context, args.deployment);
    const idempotencyKey = String(args.idempotencyKey || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new Error("idempotencyKey must be between 8 and 160 characters");
    }
    const branch = typeof args.branch === "string" ? args.branch.trim() : "";
    if (branch.length > 200) throw new Error("branch must be 200 characters or fewer");
    return enqueueOperation(context, deployment, name, idempotencyKey, {
      branch: branch || undefined,
      reason: String(args.reason || "").trim().slice(0, 500),
    });
  }

  if (name === "deployment.redeploy" || name === "deployment.restart") {
    const deployment = await allowedDeployment(context, args.deployment);
    const idempotencyKey = String(args.idempotencyKey || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new Error("idempotencyKey must be between 8 and 160 characters");
    }
    return enqueueOperation(context, deployment, name, idempotencyKey, { reason: String(args.reason || "").trim().slice(0, 500) });
  }

  if (name === "deployment.build_publish") {
    const deployment = await allowedDeployment(context, args.deployment);
    const commitSha = normalizeReleaseSha(args.commitSha);
    const idempotencyKey = String(args.idempotencyKey || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new Error("idempotencyKey must be between 8 and 160 characters");
    }
    const branch = typeof args.branch === "string" ? args.branch.trim() : "";
    if (branch.length > 200) throw new Error("branch must be 200 characters or fewer");
    const services = Array.isArray(args.services)
      ? args.services.map((service: unknown) => String(service)).filter(Boolean)
      : undefined;
    return enqueueOperation(context, deployment, name, idempotencyKey, {
      commitSha,
      branch: branch || undefined,
      services,
      builder: args.builder === "docker-agentic"
        ? "docker-agentic"
        : args.builder === "local"
          ? "local"
          : "buildkit",
      runTests: args.runTests === true,
      testCommand: typeof args.testCommand === "string" ? args.testCommand.trim() : undefined,
      reason: String(args.reason || "").trim().slice(0, 500),
    });
  }

  if (name === "deployment.release") {
    const deployment = await allowedDeployment(context, args.deployment);
    const buildOperationId = String(args.buildOperationId || "").trim();
    if (buildOperationId.length < 8) {
      throw new Error("buildOperationId is required");
    }
    const idempotencyKey = String(args.idempotencyKey || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new Error("idempotencyKey must be between 8 and 160 characters");
    }
    return enqueueOperation(context, deployment, name, idempotencyKey, {
      buildOperationId,
      expectedCurrentRevision:
        typeof args.expectedCurrentRevision === "string"
          ? args.expectedCurrentRevision.trim()
          : undefined,
      reason: String(args.reason || "").trim().slice(0, 500),
    });
  }

  if (name === "operation.get") {
    const operationId = String(args.operationId || "").trim();
    const operation = await prisma.agentOperation.findFirst({
      where: { id: operationId, grantId: context.grant.id, deploymentId: { in: context.resources } },
    });
    if (!operation) throw new Error("Operation not found for this agent grant");
    return { operation: serializeOperation(operation) };
  }

  throw new Error(`Tool not implemented: ${name}`);
}

function authorizedCapabilities(deployment: Parameters<typeof runtimeCapabilities>[0], context: AgentAccessContext) {
  const capabilities = runtimeCapabilities(deployment);
  return { ...capabilities, operations: Object.fromEntries(Object.entries(capabilities.operations).map(([name, operation]) => [name, {
    ...operation, authorized: context.scopes.has("deployment:redeploy"),
    available: operation.supported && context.scopes.has("deployment:redeploy"),
  }])) };
}

async function enqueueOperation(context: AgentAccessContext, deployment: Awaited<ReturnType<typeof allowedDeployment>>, type: string, idempotencyKey: string, input: Record<string, unknown>) {
  const inputJson = JSON.stringify({ ...input, runtimeIdentity: runtimeIdentity(deployment) });
  const lookup = () => prisma.agentOperation.findUnique({ where: { grantId_idempotencyKey: { grantId: context.grant.id, idempotencyKey } } });
  const reuse = (existing: NonNullable<Awaited<ReturnType<typeof lookup>>>) => {
    if (existing.deploymentId !== deployment.id || existing.type !== type || existing.inputJson !== inputJson) {
      throw new Error("idempotencyKey is already bound to a different deployment, operation, input or runtime identity.");
    }
    return { operation: serializeOperation(existing), reused: true };
  };
  const existing = await lookup();
  if (existing) return reuse(existing);
  requireRuntimeOperation(deployment, type);
  if (type === "deployment.first_launch") {
    const recipe = await prisma.agentDeploymentRecipe.findUnique({ where: { deploymentId: deployment.id } });
    if (!recipe || recipe.status !== "pending" || recipe.launchOperationId || recipe.recipeHash !== input.recipeHash || recipe.userId !== context.user.id) throw new Error("The owner-approved first-launch recipe is not pending or is already claimed.");
  }
  try {
    const operation = await prisma.agentOperation.create({ data: { grantId: context.grant.id, deploymentId: deployment.id, type, idempotencyKey, inputJson } });
    return { operation: serializeOperation(operation), reused: false };
  } catch (error) {
    // A concurrent identical request may have won the unique-key insert.
    if ((error as { code?: string }).code !== "P2002") throw error;
    const winner = await lookup();
    if (!winner) throw error;
    return reuse(winner);
  }
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
