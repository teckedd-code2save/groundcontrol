import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { HttpError } from "./errors";
import { scanSourceFolder } from "./source-discovery";
import { getSystemConfig, type VpsConnection } from "./vps";
import { isDesktopMode } from "./runtime";
import { candidateIdentity, setSuggestionHidden } from "./inventory-discovery";

export async function discoverSourceProjects(vps: VpsConnection | null) {
  const desktop = isDesktopMode() && vps?.isLocal;
  const root = desktop ? process.env.GC_WORKSPACE_ROOT : (await getSystemConfig()).projectRoot;
  if (!root) return { projects: [], error: null };
  try {
    const scan = await scanSourceFolder(root, vps);
    return { projects: scan.projects, error: null };
  } catch (error) {
    return { projects: [], error: error instanceof HttpError ? error.message : "Folder discovery is unavailable. You can still add a project by choosing its folder." };
  }
}

/** Save a source on a real project; this never creates a deployment. */
export async function addSourceProject(input: unknown, vps: VpsConnection | null, projectId?: number | null, name?: string, description?: string) {
  if (!vps) throw new HttpError("Choose a connection before adding a project.", 400);
  const { folder } = await scanSourceFolder(input, vps, false);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectSource.findUnique({ where: { vpsConfigId_path: { vpsConfigId: vps.id, path: folder.sourcePath } }, include: { projectGroup: true } });
    if (existing) {
      if (projectId && existing.projectGroupId !== projectId) throw new HttpError(`This folder already belongs to ${existing.projectGroup.name}. Remove its source link there before adding it here.`, 409);
      return { source: existing, project: existing.projectGroup };
    }
    const chosen = projectId ? await tx.projectGroup.findUnique({ where: { id: projectId } }) : null;
    if (projectId && !chosen) throw new HttpError("That project no longer exists. Refresh and try again.", 404);
    const displayName = name?.trim().slice(0, 120) || folder.name;
    const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";
    const suffix = createHash("sha256").update(`${vps.id}:${folder.sourcePath}`).digest("hex").slice(0, 10);
    const project = chosen || await tx.projectGroup.create({ data: { slug: `${base}-${suffix}`, name: displayName, description: description?.trim().slice(0, 2000) || "" } });
    const source = await tx.projectSource.create({ data: { projectGroupId: project.id, vpsConfigId: vps.id, path: folder.sourcePath, metadataJson: JSON.stringify({ sourceProject: folder }) } });
    return { project, source };
  });
  await setSuggestionHidden(vps.id, candidateIdentity(folder), false);
  return result;
}
