import { parseResourceIds } from "./oauth";
import { prisma } from "./prisma";
import { HttpError } from "./errors";
import { jsonObject, runtimeIdentity } from "./agent-runtime-capabilities";
import { normalizeCommitSha, normalizeSourceBranch, sourceAccessForDeployment } from "./github-source-deploy";

export type GithubDelivery = { executor: "agent" | "actions"; branch: string; autoDeploy: boolean; workflowName: string; grantId?: number; requestedSha?: string };
export function deliveryOptions(value: unknown, branch: unknown): GithubDelivery | null {
  if (!value) return null;
  const input = value as Record<string, unknown>;
  if (input.executor !== "agent" && input.executor !== "actions") throw new HttpError("Choose GroundControl or GitHub Actions to build images.", 400);
  const workflowName = String(input.workflowName || "").trim();
  if (input.executor === "actions" && (!workflowName || workflowName.length > 150)) throw new HttpError("Name the GitHub Actions workflow that builds and tests the images.", 400);
  return { executor: input.executor, branch: normalizeSourceBranch(branch), autoDeploy: input.autoDeploy === true, workflowName };
}
export function readDelivery(metadata: string | null | undefined): GithubDelivery | null {
  const value = jsonObject(metadata).githubDelivery;
  if (!value || typeof value !== "object") return null;
  const policy = value as GithubDelivery;
  return policy.executor === "agent" || policy.executor === "actions" ? policy : null;
}

/** An owner-approved workflow grant has no redirect URI or issued OAuth tokens.
 * MCP creation instead uses its already-approved external grant so operation evidence and
 * subsequent delivery remain revocable and visible through the same connection. */
export async function startGithubDelivery(userId: number, deploymentId: number, commitSha: string, policy: GithubDelivery, externalGrantId?: number) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "admin" || user.forcePasswordChange) throw new HttpError("Administrator access is required to deploy.", 403);
    const deployment = await tx.enrolledDeployment.findUniqueOrThrow({ where: { id: deploymentId }, include: { legacyProject: true } });
    const grant = externalGrantId ? await tx.oAuthGrant.findUniqueOrThrow({ where: { id: externalGrantId } }) : await (async () => {
    const client = await tx.oAuthClient.upsert({
      where: { clientId: `urn:groundcontrol:delivery:${userId}:${deploymentId}` },
      create: { clientId: `urn:groundcontrol:delivery:${userId}:${deploymentId}`, clientName: `GitHub delivery: ${deployment.name}`, source: "internal", redirectUris: "[]" }, update: {},
    });
    return tx.oAuthGrant.upsert({
      where: { userId_clientDbId: { userId, clientDbId: client.id } },
      create: { userId, clientDbId: client.id, scope: "deployment:read deployment:redeploy", resources: JSON.stringify([deploymentId]) },
      update: { scope: "deployment:read deployment:redeploy", resources: JSON.stringify([deploymentId]), revokedAt: null },
    });
    })();
    if (externalGrantId && (grant.userId !== userId || grant.revokedAt || !parseResourceIds(grant.resources).includes(deploymentId) || !grant.scope.split(/\s+/).includes("deployment:redeploy") || !grant.scope.split(/\s+/).includes("deployment:create") || !parseResourceIds(grant.creationHosts).includes(deployment.vpsConfigId || 0))) throw new HttpError("First-deployment permission changed before delivery was queued.", 403);
    const sha = normalizeCommitSha(commitSha);
    if (!sha) throw new HttpError("An exact repository commit is required.", 400);
    await tx.enrolledDeployment.update({ where: { id: deploymentId }, data: { status: "pending", metadataJson: JSON.stringify({ ...jsonObject(deployment.metadataJson), githubDelivery: { ...policy, grantId: grant.id, requestedSha: sha } }) } });
    return tx.agentOperation.upsert({
      where: { grantId_idempotencyKey: { grantId: grant.id, idempotencyKey: `github-first:${deploymentId}:${sha}` } }, update: {},
      create: { grantId: grant.id, deploymentId, type: "deployment.build_publish", idempotencyKey: `github-first:${deploymentId}:${sha}`, inputJson: JSON.stringify({ branch: policy.branch, commitSha: sha, builder: "buildkit", verifyPublished: policy.executor === "actions", releaseAfterBuild: true, actionsWorkflowName: policy.workflowName, runtimeIdentity: runtimeIdentity(deployment), reason: "First deployment from GitHub" }) },
    });
  });
}

export function deliveryCommit(event: string, payload: Record<string, unknown>, policy: GithubDelivery): string | null {
  if (!policy.autoDeploy) return null;
  if (policy.executor === "agent") {
    return event === "push" && payload.ref === `refs/heads/${policy.branch}` ? normalizeCommitSha(payload.after) : null;
  }
  const run = payload.workflow_run as Record<string, unknown> | undefined;
  const repo = payload.repository as { full_name?: string } | undefined;
  const headRepo = run?.head_repository as { full_name?: string } | undefined;
  return event === "workflow_run" && payload.action === "completed" && run?.conclusion === "success" && run.status === "completed"
    && run.name === policy.workflowName && run.head_branch === policy.branch && ["push", "workflow_dispatch"].includes(String(run.event))
    && Boolean(repo?.full_name) && headRepo?.full_name === repo?.full_name ? normalizeCommitSha(run.head_sha) : null;
}

export async function githubBranchHead(deploymentId: number, branch?: string) {
  const access = await sourceAccessForDeployment(deploymentId);
  const response = await fetch(`https://api.github.com/repos/${access.repository.fullName}/commits/${encodeURIComponent(normalizeSourceBranch(branch || access.repository.defaultBranch))}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${access.token}`, "User-Agent": "GroundControl" }, cache: "no-store",
  });
  if (!response.ok) throw new HttpError("Could not verify the current GitHub branch revision.", 409);
  const data = await response.json();
  const sha = normalizeCommitSha(data.sha);
  if (!sha) throw new HttpError("GitHub returned no valid commit revision.", 409);
  return sha;
}

export async function verifyActionsBuild(deploymentId: number, sha: string, branch: string, workflowName: string) {
  if (!workflowName) throw new HttpError("Choose the Actions build workflow before using published images.", 400);
  const access = await sourceAccessForDeployment(deploymentId);
  const response = await fetch(`https://api.github.com/repos/${access.repository.fullName}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${access.token}`, "User-Agent": "GroundControl" }, cache: "no-store",
  });
  if (!response.ok) throw new HttpError("Could not verify the Actions build. Check the GitHub App Actions read permission.", 409);
  const data = await response.json();
  const run = (data.workflow_runs || []).find((item: { name: string; head_sha: string; head_branch: string; status: string; conclusion: string; event: string; head_repository?: { full_name: string } }) =>
    item.name === workflowName && item.head_sha === sha && item.head_branch === branch
    && ["push", "workflow_dispatch"].includes(item.event) && item.head_repository?.full_name === access.repository.fullName);
  if (!run || run.status !== "completed" || run.conclusion !== "success") throw new HttpError(`Wait for ${workflowName} to succeed for commit ${sha.slice(0, 12)}, then retry image delivery.`, 409);
  return { workflowRunId: run.id as number, workflowName };
}
