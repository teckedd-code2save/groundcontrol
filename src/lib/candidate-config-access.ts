import { prisma } from "./prisma";
import { HttpError } from "./errors";

/** Preserve legacy project behavior; candidate configuration is restricted to its current owner/admin. */
export async function requireCandidateConfigOwner(userId: number | null, projectId: number, profileId?: number) {
  const mapping = await prisma.agentProposalConfiguration.findFirst({
    where: { OR: [{ projectId }, ...(profileId === undefined ? [] : [{ profileId }])] },
  });
  if (!mapping) return null;
  if (mapping.projectId !== projectId || userId !== mapping.userId) throw new HttpError("Candidate configuration is available only to its owner.", 403);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "admin" || user.forcePasswordChange) throw new HttpError("Current owner administrator access is required for candidate configuration.", 403);
  return mapping;
}

/** Candidate secrets may only reach the explicitly bound host through the reviewed pipeline. */
export async function rejectCandidateLegacyMutation(userId: number | null, projectId: number) {
  const mapping = await requireCandidateConfigOwner(userId, projectId);
  if (mapping) throw new HttpError("Candidate workloads must use their scoped, owner-approved first-launch or source-update operation; generic active-server deployment is disabled.", 409);
}
