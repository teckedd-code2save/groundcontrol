import type { EnrolledDeployment, PrismaClient, Project } from "@prisma/client";
import { HttpError } from "./errors";
import { execOnTargetStrict } from "./host-exec";
import { shQuote, type VpsConnection } from "./vps";

const conflict = "This deployment already exists. Open it to inspect its state and release an update.";

/** Only an owner UI launch that stopped before image delivery may prepare again. */
export async function claimPreparationRetry(input: {
  existing: EnrolledDeployment | null;
  project: Project | null;
  projectGroupId: number;
  templateName: string;
  repoUrl: string;
  branch: string;
  domain: string;
  sourcePath: string;
  composePath: string;
  composeProject: string;
  vps: VpsConnection;
}, db: Pick<PrismaClient, "deployment" | "agentOperation" | "enrolledDeployment">): Promise<() => Promise<void>> {
  const { existing, project, vps } = input;
  if (!existing || !project) throw new HttpError(conflict, 409);
  let metadata, source;
  try {
    metadata = JSON.parse(existing.metadataJson);
    source = JSON.parse(project.envVars || "{}").source;
  } catch { throw new HttpError(conflict, 409); }
  if (existing.status === "preparing" || existing.managementMode !== "managed" || existing.kind !== "compose"
    || existing.legacyProjectId !== project.id || existing.projectGroupId !== input.projectGroupId
    || project.projectGroupId !== input.projectGroupId || existing.vpsConfigId !== vps.id
    || existing.sourcePath !== input.sourcePath || project.path !== input.sourcePath
    || existing.composePath !== input.composePath || project.repoUrl !== input.repoUrl
    || project.domain !== input.domain || !["pending", "failed"].includes(project.status)
    || metadata?.source !== "template" || metadata.templateName !== input.templateName
    || metadata.composeProject !== input.composeProject || metadata.githubDelivery
    || source?.repoUrl !== input.repoUrl || (source.branch || source.requestedRef || "main") !== input.branch) {
    throw new HttpError(conflict, 409);
  }
  const releases = await db.deployment.findMany({ where: { projectId: project.id } });
  const prepared = releases.some(release => {
    try { return JSON.parse(release.output || "{}").upOutput?.stdout === "Image delivery prepared; runtime has not started."; }
    catch { return false; }
  });
  if (!prepared || releases.some(release => !["pending", "failed"].includes(release.status))
    || await db.agentOperation.count({ where: { deploymentId: existing.id, status: { notIn: ["failed", "cancelled"] } } })) {
    throw new HttpError(conflict, 409);
  }
  // Compare-and-set makes concurrent retries refuse before touching source, env or routing.
  const claimed = await db.enrolledDeployment.updateMany({
    where: { id: existing.id, updatedAt: existing.updatedAt, status: existing.status },
    data: { status: "preparing" },
  });
  if (claimed.count !== 1) throw new HttpError("Deployment preparation changed. Refresh before retrying.", 409);
  const release = async () => {
    await db.enrolledDeployment.updateMany({ where: { id: existing.id, status: "preparing" }, data: { status: existing.status } });
  };
  try {
    const runtime = await execOnTargetStrict(`docker ps -aq --filter ${shQuote(`label=com.docker.compose.project=${input.composeProject}`)}`, vps);
    if (runtime.code !== 0 || runtime.stdout.trim()) throw new HttpError("The deployment has containers or its runtime could not be inspected. Open the deployment before retrying.", 409);
    return release;
  } catch (error) { await release(); throw error; }
}
