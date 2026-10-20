import { prisma } from "./prisma";
import { HttpError } from "./errors";
import { getDockerContainers, getDockerContainerLabels, type VpsConnection } from "./vps";
import { buildInventoryCandidates, candidateIdentity, setSuggestionHidden } from "./inventory-discovery";

export function deploymentEnvironment(input: unknown) {
  const value = typeof input === "string" ? input.trim() : "Unspecified";
  if (!value || value.length > 60 || /[\x00-\x1f]/.test(value)) throw new HttpError("Give this deployment an environment, such as Local, Staging, or Production.", 400);
  return value;
}

export async function connectExistingDeployment(body: Record<string, unknown>, vps: VpsConnection | null) {
  if (!vps) throw new HttpError("Choose a connection first.", 400);
  const environmentName = deploymentEnvironment(body.environmentName);
  const projectGroupId = body.projectId ? Number(body.projectId) : null;
  if (projectGroupId && !await prisma.projectGroup.findUnique({ where: { id: projectGroupId } })) throw new HttpError("Project not found.", 404);
  const [containers, labels] = await Promise.all([getDockerContainers(vps), getDockerContainerLabels(vps)]);
  const candidates = buildInventoryCandidates([], [], containers, labels, []);
  const id = String(body.candidateId || body.id || candidateIdentity(body as { sourcePath?: string; containerName?: string; composeProject?: string }));
  const candidate = candidates.find((item) => item.id === id);
  if (!candidate) throw new HttpError("This running app is no longer available. Refresh discovery and try again.", 409);
  const result = await prisma.$transaction(async (tx) => {
    const tracked = await tx.enrolledDeployment.findMany({ where: { vpsConfigId: vps.id, kind: { not: "source" } } });
    const existing = tracked.find((item) => candidateIdentity(item) === id);
    if (existing) {
      if (projectGroupId && existing.projectGroupId !== projectGroupId) throw new HttpError("This deployment is already tracked. Select it from existing deployments to move it to this project.", 409);
      return existing;
    }
    const name = String(body.name || candidate.name).trim().slice(0, 120);
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "deployment";
    let slug = base; let suffix = 1;
    while (await tx.enrolledDeployment.findUnique({ where: { slug } }) || await tx.project.findUnique({ where: { slug } })) slug = `${base}-${++suffix}`;
    // Each instance has its own release/config record, even when source is shared.
    const legacy = candidate.sourcePath ? await tx.project.create({ data: { slug, name, path: candidate.sourcePath, projectGroupId, category: candidate.kind === "compose" ? "docker" : "app", envVars: JSON.stringify({ composeProject: candidate.composeProject }) } }) : null;
    return tx.enrolledDeployment.create({ data: {
      name, slug, kind: candidate.kind, environmentName, projectGroupId, vpsConfigId: vps.id,
      sourcePath: candidate.sourcePath, composePath: candidate.composePath, containerName: candidate.containerName,
      legacyProjectId: legacy?.id, managementMode: "track", status: "observed", lastSeenAt: new Date(),
      metadataJson: JSON.stringify({ composeProject: candidate.composeProject, image: candidate.image, enrolledFrom: "runtime" }),
    } });
  });
  await setSuggestionHidden(vps.id, id, false);
  return result;
}
