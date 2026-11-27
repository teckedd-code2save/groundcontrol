import { createHash } from "node:crypto";
import { parse } from "yaml";
import { prisma } from "./prisma";
import { HttpError } from "./errors";
import { parseResourceIds, scopeSet } from "./oauth";
import { githubProjectAccess, githubProjectIdentity } from "./github-project-import";
import { githubRegistryPublicState } from "./github-registry";
import { normalizeCommitSha, normalizeSourceBranch } from "./github-source-deploy";
import { normalizeRepositoryComposePath, inspectRepositoryCompose } from "./repository-compose";
import { slugifyDeploymentName } from "./deployment-identity";
import type { AgentAccessContext } from "./mcp-agent";

export type CreationSpec = {
  hostId: number; repositoryUrl: string; branch: string; commitSha: string;
  name: string; environmentName: string; composeFile: string; domain: string;
  publicService: string; publicPort: string; healthPath: string;
  executor: "agent" | "actions"; workflowName: string; autoDeploy: boolean;
  generatedEnvironmentKeys: string[];
};
const requiredScopes = ["deployment:create", "deployment:read", "deployment:redeploy", "operation:read"];
export function assertCreationGrant(grant: { scope: string; creationHosts?: string; revokedAt?: Date | null }, user: { role: string; forcePasswordChange?: boolean }, hostId?: number) {
  if (grant.revokedAt || user.role !== "admin" || user.forcePasswordChange || !requiredScopes.every(scope => scopeSet(grant.scope).has(scope))) throw new HttpError("Reconnect with explicit first-deployment permission and select its allowed hosts.", 403);
  if (hostId !== undefined && !parseResourceIds(grant.creationHosts).includes(hostId)) throw new HttpError("This host is not approved for creating deployments.", 403);
}
export function normalizeCreationSpec(args: Record<string, unknown>): CreationSpec {
  const hostId = Number(args.hostId);
  if (!Number.isSafeInteger(hostId) || hostId < 1) throw new HttpError("Choose an approved hostId.", 400);
  const name = String(args.name || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(name)) throw new HttpError("Use a deployment name of 2–40 lowercase letters, numbers or hyphens.", 400);
  const environmentName = String(args.environmentName || "staging").trim();
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(environmentName)) throw new HttpError("Use a short lowercase environment name.", 400);
  const domain = String(args.domain || "").toLowerCase().trim();
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new HttpError("A DNS hostname is required. Point it at the selected host using your authorized DNS provider.", 400);
  const publicPort = String(args.publicPort || "");
  if (!/^\d+$/.test(publicPort) || Number(publicPort) < 1024 || Number(publicPort) > 65535 || publicPort === "3003") throw new HttpError("Choose an unused application port from 1024–65535, excluding GroundControl's management port.", 400);
  const publicService = String(args.publicService || "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(publicService)) throw new HttpError("Choose the public Compose service.", 400);
  const healthPath = String(args.healthPath || "/");
  if (!/^\/[a-zA-Z0-9/_\.~-]*$/.test(healthPath)) throw new HttpError("Use a path such as /healthz for verification.", 400);
  const executor = args.executor;
  if (executor !== "actions" && executor !== "agent") throw new HttpError("Choose actions or agent as the image publisher.", 400);
  const workflowName = String(args.workflowName || "").trim();
  if (executor === "actions" && (!workflowName || workflowName.length > 150)) throw new HttpError("Name the Actions workflow that tests and publishes images.", 400);
  const keys = args.generatedEnvironmentKeys ?? [];
  if (!Array.isArray(keys) || keys.length > 30 || keys.some(key => typeof key !== "string" || !/^[A-Z_][A-Z0-9_]{0,99}$/.test(key))) throw new HttpError("generatedEnvironmentKeys must contain environment key names only.", 400);
  const commitSha = normalizeCommitSha(args.commitSha);
  if (!commitSha) throw new HttpError("An exact full commit SHA is required.", 400);
  return { hostId, name, environmentName, domain, publicPort, publicService, healthPath, executor, workflowName, commitSha,
    repositoryUrl: `https://github.com/${githubProjectIdentity(args.repositoryUrl)}`,
    branch: normalizeSourceBranch(args.branch), composeFile: normalizeRepositoryComposePath(String(args.composeFile || "compose.yml")),
    autoDeploy: args.autoDeploy === true, generatedEnvironmentKeys: [...new Set(keys as string[])].sort() };
}

/** First launch must not adopt host mounts, shared volumes/networks or named containers. */
export function validateCreationCompose(content: string, spec: CreationSpec) {
  const doc = parse(content);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new HttpError("Compose must be an object.", 400);
  if (doc.include || doc.name) throw new HttpError("First launch requires a self-contained Compose file with a GC-scoped project name.", 400);
  for (const section of ["volumes", "networks", "configs", "secrets"]) {
    for (const value of Object.values(doc[section] || {})) {
      const item = value as Record<string, unknown> | null;
      if (item?.external || item?.name || item?.driver_opts || (section === "volumes" && item?.driver && item.driver !== "local")) throw new HttpError("First launch cannot adopt externally named or host-backed resources.", 400);
    }
  }
  for (const service of Object.values(doc.services || {})) {
    const item = service as Record<string, unknown>;
    if (["privileged", "container_name", "network_mode", "pid", "ipc", "devices", "cap_add", "extends", "volumes_from", "use_api_socket"].some(key => item[key])) throw new HttpError("First launch cannot use privileged, shared-host or externally named service settings.", 400);
    for (const port of Array.isArray(item.ports) ? item.ports : []) {
      const valid = typeof port === "string" ? /^127\.0\.0\.1:\d+:\d+(?:\/(tcp|udp))?$/.test(port)
        : port && port.host_ip === "127.0.0.1" && /^\d+$/.test(String(port.published)) && /^\d+$/.test(String(port.target));
      if (!valid) throw new HttpError("Use literal loopback port bindings for first launch; port ranges and dynamic bindings require review.", 400);
    }
    for (const mount of Array.isArray(item.volumes) ? item.volumes : []) {
      const source = typeof mount === "string" ? mount.split(":")[0] : mount.source;
      if (typeof mount === "object" && mount.type !== "volume" || typeof source !== "string" || !/^[a-zA-Z0-9_-]+$/.test(source) || !Object.hasOwn(doc.volumes || {}, source)) throw new HttpError("First launch permits only project-scoped named data volumes.", 400);
    }
  }
  const inspection = inspectRepositoryCompose(content);
  if (!inspection.publishedPorts.some(port => port.service === spec.publicService && port.hostPort === spec.publicPort)) throw new HttpError("The selected service and host port do not match the Compose file.", 400);
  for (const port of inspection.publishedPorts) {
    if (port.hostIp !== "127.0.0.1" || Number(port.hostPort) < 1024 || port.hostPort === "3003") throw new HttpError("First launch publishes application ports on 127.0.0.1 behind the existing proxy; database ports stay private.", 400);
  }
  const missing = inspection.environment.filter(env => env.required && !spec.generatedEnvironmentKeys.includes(env.key)).map(env => env.key);
  if (missing.length) throw new HttpError(`Required environment keys need configuration before launch: ${missing.join(", ")}. Use repository defaults for non-secret settings and generatedEnvironmentKeys only for new random credentials; configure external credentials in GC.`, 409);
  if (spec.generatedEnvironmentKeys.some(key => !inspection.environment.some(env => env.key === key))) throw new HttpError("Generate only environment keys referenced by this Compose file.", 400);
  return inspection;
}

export async function creationOptions(context: AgentAccessContext) {
  assertCreationGrant(context.grant, context.user);
  const [hosts, repositories, registry] = await Promise.all([
    prisma.vpsConfig.findMany({ where: { id: { in: parseResourceIds(context.grant.creationHosts) } }, select: { id: true, name: true, host: true } }),
    prisma.githubRepository.findMany({ where: { isArchived: false, installation: { suspendedAt: null } }, select: { fullName: true, htmlUrl: true, defaultBranch: true } }),
    githubRegistryPublicState(),
  ]);
  return { hosts, repositories, registryConfigured: registry.configured, routing: "Existing Caddy with a new hostname; DNS must already point to this host. No firewall or provider changes.", secretConfiguration: "New random credentials can be generated by key name. External credentials must be configured through GC, never pasted into chat." };
}

export async function inspectCreationSpec(spec: CreationSpec) {
  const host = await prisma.vpsConfig.findUnique({ where: { id: spec.hostId }, select: { id: true } });
  if (!host) throw new HttpError("The selected host no longer exists.", 409);
  if (!(await githubRegistryPublicState()).configured) throw new HttpError("Connect GitHub package access in GC Settings → Connectors.", 409);
  const access = await githubProjectAccess(spec.repositoryUrl);
  if (!access.repositoryId) throw new HttpError("Connect this repository to the GC GitHub App in Settings → Connectors.", 409);
  const endpoint = `https://api.github.com/repos/${githubProjectIdentity(spec.repositoryUrl)}`;
  const head = await fetch(`${endpoint}/commits/${encodeURIComponent(spec.branch)}`, { headers: access.headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!head.ok || (await head.json()).sha !== spec.commitSha) throw new HttpError("The branch head no longer matches the requested commit. Inspect the new revision before launching.", 409);
  const file = await fetch(`${endpoint}/contents/${spec.composeFile.split("/").map(encodeURIComponent).join("/")}?ref=${spec.commitSha}`, { headers: access.headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!file.ok) throw new HttpError("The Compose file could not be read at the requested commit.", 409);
  const blob = await file.json();
  if (blob.type !== "file" || blob.encoding !== "base64" || !blob.content || blob.size > 262144) throw new HttpError("Use a regular repository Compose file smaller than 256 KiB.", 400);
  const content = Buffer.from(blob.content, "base64").toString("utf8");
  const inspection = validateCreationCompose(content, spec);
  return { repositoryId: access.repositoryId, composeHash: createHash("sha256").update(content).digest("hex"), services: inspection.services, environmentKeys: inspection.environment.map(env => env.key) };
}

export async function queueCreation(context: AgentAccessContext, args: Record<string, unknown>) {
  const spec = normalizeCreationSpec(args);
  assertCreationGrant(context.grant, context.user, spec.hostId);
  const key = String(args.idempotencyKey || "").trim();
  if (key.length < 8 || key.length > 160) throw new HttpError("idempotencyKey must be 8–160 characters.", 400);
  const inputJson = JSON.stringify(spec);
  const lookup = () => prisma.agentOperation.findUnique({ where: { grantId_idempotencyKey: { grantId: context.grant.id, idempotencyKey: key } } });
  const reuse = (prior: NonNullable<Awaited<ReturnType<typeof lookup>>>) => {
    if (prior.type !== "deployment.create" || prior.inputJson !== inputJson) throw new HttpError("This idempotencyKey belongs to different creation inputs.", 409);
    return { operation: prior, reused: true };
  };
  const prior = await lookup(); if (prior) return reuse(prior);
  await inspectCreationSpec(spec);
  const config = await prisma.systemConfig.findUnique({ where: { vpsConfigId: spec.hostId } });
  const root = String(config?.templateDeploymentRoot || "/srv/groundcontrol/deployments").replace(/\/+$/, "");
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(root) || root === "/") throw new HttpError("Choose a dedicated absolute deployment root in GC Settings.", 409);
  const projectSlug = `${spec.name}-${createHash("sha256").update(spec.repositoryUrl.toLowerCase()).digest("hex").slice(0, 8)}`;
  const slug = slugifyDeploymentName(`${projectSlug.slice(0, 35)}-${spec.environmentName}-${spec.name}`);
  try {
    return await prisma.$transaction(async tx => {
      const grant = await tx.oAuthGrant.findUniqueOrThrow({ where: { id: context.grant.id }, include: { user: true } });
      assertCreationGrant(grant, grant.user, spec.hostId);
      const concurrent = await tx.agentOperation.findUnique({ where: { grantId_idempotencyKey: { grantId: context.grant.id, idempotencyKey: key } } });
      if (concurrent) return reuse(concurrent);
      // Reservation is atomic: a collision never updates an existing workload.
      if (await tx.enrolledDeployment.findUnique({ where: { slug } }) || await tx.project.findUnique({ where: { slug } })) throw new HttpError("This deployment name already exists. Inspect it or choose another name; creation never replaces an app.", 409);
      const group = await tx.projectGroup.upsert({ where: { slug: projectSlug }, update: {}, create: { slug: projectSlug, name: spec.name, repositoryUrl: spec.repositoryUrl, repositoryDefaultBranch: spec.branch } });
      if (group.repositoryUrl !== spec.repositoryUrl) throw new HttpError("Project source changed. Inspect before creating a deployment.", 409);
      const project = await tx.project.create({ data: { slug, name: spec.name, path: `${root}/${slug}`, repoUrl: spec.repositoryUrl, projectGroupId: group.id, category: "docker", status: "pending" } });
      const deployment = await tx.enrolledDeployment.create({ data: { slug, name: spec.name, kind: "compose", managementMode: "managed", status: "pending", environmentName: spec.environmentName, vpsConfigId: spec.hostId, projectGroupId: group.id, legacyProjectId: project.id, sourcePath: project.path, metadataJson: JSON.stringify({ creationPending: true }) } });
      const operation = await tx.agentOperation.create({ data: { grantId: grant.id, deploymentId: deployment.id, type: "deployment.create", idempotencyKey: key, inputJson } });
      await tx.oAuthGrant.update({ where: { id: grant.id }, data: { resources: JSON.stringify([...new Set([...parseResourceIds(grant.resources), deployment.id])]) } });
      return { operation, reused: false };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") { const winner = await lookup(); if (winner) return reuse(winner); }
    throw error;
  }
}
