import type { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { requireAuth } from "./auth";
import { HttpError } from "./errors";
import { composeDirectory, jsonObject, requireRuntimeOperation, runtimeIdentity } from "./agent-runtime-capabilities";

/** Recheck the durable grant immediately before work. Never fall back to the active host. */
export async function agentOperationTarget(req: NextRequest, types: string[], observing = false) {
  const id = req.headers.get("X-GroundControl-Agent-Operation");
  if (!id) return null;
  const user = requireAuth(req);
  const operation = await prisma.agentOperation.findUnique({
    where: { id },
    include: {
      grant: { include: { user: true } },
      deployment: { include: { vpsConfig: true, legacyProject: true, githubRepositories: { select: { githubRepositoryId: true } } } },
    },
  });
  if (!operation || operation.grant.userId !== user.id || !types.includes(operation.type)) throw new HttpError("Agent operation is not authorized for this request.", 403);
  const { grant, deployment } = operation;
  let resources: unknown = [];
  try { resources = JSON.parse(grant.resources); } catch {}
  if (!observing && (grant.revokedAt || grant.user.role !== "admin" || grant.user.forcePasswordChange || !grant.scope.split(/\s+/).includes("deployment:redeploy") || !Array.isArray(resources) || !resources.includes(deployment.id))) {
    throw new HttpError("The approving grant no longer authorizes this operation.", 403);
  }
  if (operation.status !== (observing ? "verifying" : "running")) throw new HttpError("This operation is not executable in its current state.", 409);
  if (!deployment.vpsConfig) throw new HttpError("The enrolled deployment has no host.", 409);
  const input = jsonObject(operation.inputJson);
  if (input.runtimeIdentity && input.runtimeIdentity !== runtimeIdentity(deployment)) throw new HttpError("Deployment identity changed after this operation was requested. Inspect before retrying.", 409);
  if (!observing) requireRuntimeOperation(deployment, operation.type);
  return {
    operation, deployment, input, vps: { ...deployment.vpsConfig, privateKey: deployment.vpsConfig.privateKey ?? undefined, password: deployment.vpsConfig.password ?? undefined },
    projectSlug: deployment.legacyProject?.slug || deployment.slug,
    projectPath: composeDirectory(deployment),
    logFile: `/tmp/gc-agent-${operation.id.replace(/[^a-zA-Z0-9_-]/g, "")}.log`,
  };
}

export function assertAgentProject(target: Awaited<ReturnType<typeof agentOperationTarget>>, slug: unknown) {
  if (target && target.projectSlug !== slug) throw new HttpError("Requested project does not match the approved deployment.", 403);
}
