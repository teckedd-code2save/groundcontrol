import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { HttpError } from "./errors";
import type { ScannedProject } from "./project-scan";
import type { DockerContainerLabelInfo } from "./vps";
import type { SourceProject } from "./source-discovery";

export type InventoryCandidate = {
  id: string; name: string; kind: string; sourcePath?: string | null;
  composePath?: string | null; containerName?: string | null;
  composeProject?: string; image?: string; components?: number;
  services?: { name: string; containerName: string; state: string; image: string }[];
  evidence: string[];
};

export function candidateIdentity(item: { sourcePath?: string | null; containerName?: string | null; composeProject?: string | null; metadataJson?: string | null }): string {
  let composeProject = item.composeProject;
  try { composeProject ||= JSON.parse(item.metadataJson || "{}").composeProject; } catch {}
  if (composeProject) return `compose:${composeProject}`;
  if (item.containerName) return `container:${item.containerName}`;
  if (item.sourcePath) return `folder:${item.sourcePath.replace(/\/+$/, "")}`;
  return `container:${item.containerName}`;
}

export function buildInventoryCandidates(
  tree: ScannedProject[],
  sources: SourceProject[],
  containers: { name: string; image: string; state: string }[],
  labels: DockerContainerLabelInfo[],
  enrolled: { sourcePath?: string | null; containerName?: string | null; metadataJson?: string | null }[],
): InventoryCandidate[] {
  const paths = new Set(enrolled.filter((item) => candidateIdentity(item).startsWith("folder:")).map((item) => item.sourcePath?.replace(/\/+$/, "")).filter(Boolean));
  const names = new Set(enrolled.map((item) => item.containerName).filter(Boolean));
  const trackedCompose = new Set(enrolled.flatMap((item) => {
    try { const name = JSON.parse(item.metadataJson || "{}").composeProject; return typeof name === "string" ? [name] : []; } catch { return []; }
  }));
  const labelMap = new Map(labels.map((item) => [item.name, item]));
  const candidates = new Map<string, InventoryCandidate>();
  for (const project of sources) {
    const id = candidateIdentity(project);
    if (paths.has(project.sourcePath) || /^\/opt\/groundcontrol(?:\/|$)/.test(project.sourcePath)) continue;
    candidates.set(id, { id, name: project.name, kind: "source", sourcePath: project.sourcePath, composePath: project.composePath, evidence: project.technologies.length ? project.technologies : ["Project folder"] });
  }
  for (const project of tree) {
    if (paths.has(project.path) || /^\/opt\/groundcontrol(?:\/|$)/.test(project.path)) continue;
    const id = candidateIdentity({ sourcePath: project.path });
    candidates.set(id, { id, name: project.name, kind: "source", sourcePath: project.path, composePath: project.composePath, components: project.services.length, evidence: [project.hasGit ? "Git repository" : "Docker Compose", `${project.services.length} services`] });
  }
  for (const container of containers) {
    const label = labelMap.get(container.name);
    if (label?.project && trackedCompose.has(label.project)) continue;
    if (names.has(container.name) || label?.internal || label?.installMode || container.name === "groundcontrol-web" || /^gc-desktop-before-/.test(container.name) || /^groundcontrol-host-bridge(?::|@|$)/.test(container.image)) continue;
    const sourcePath = label?.workingDir?.replace(/\/+$/, "") || null;
    if (sourcePath && (paths.has(sourcePath) || /^\/opt\/groundcontrol(?:\/|$)/.test(sourcePath))) continue;
    const composeProject = label?.project || undefined;
    const id = candidateIdentity({ sourcePath, containerName: container.name, composeProject });
    const candidate = candidates.get(id) || {
      id, name: composeProject || container.name, kind: sourcePath || composeProject ? "compose" : "container",
      sourcePath, composePath: label?.configFiles?.split(",")[0] || null,
      // A Compose project is enrolled once; runtime matching uses its folder/label.
      containerName: composeProject ? null : container.name,
      composeProject, image: container.image, evidence: [],
    };
    candidate.kind = sourcePath || composeProject ? "compose" : "container";
    candidate.composeProject = composeProject;
    candidate.composePath ||= label?.configFiles?.split(",")[0] || null;
    candidate.services ||= [];
    candidate.services.push({ name: label?.service || container.name, containerName: container.name, state: container.state, image: container.image });
    candidate.components = candidate.services.length;
    candidate.evidence = [candidate.kind === "compose" ? `${candidate.services.length} services · Docker Compose` : "Docker container", `${candidate.services.filter((item) => item.state === "running").length} running`];
    candidates.set(id, candidate);
  }
  return [...candidates.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function dismissalPrefix(hostId: number | null) { return `discovery.hidden.${hostId ?? "local"}.`; }
export function dismissalKey(hostId: number | null, id: string) {
  if (!/^(folder|container|compose):.{1,2048}$/.test(id)) throw new HttpError("Invalid suggestion.", 400);
  return dismissalPrefix(hostId) + createHash("sha256").update(id).digest("hex");
}
export async function dismissedSuggestions(hostId: number | null) {
  const rows = await prisma.appConfig.findMany({ where: { key: { startsWith: dismissalPrefix(hostId) } } });
  return new Set(rows.map((row) => row.value));
}
export async function setSuggestionHidden(hostId: number | null, id: string, hidden: boolean) {
  const key = dismissalKey(hostId, id);
  if (hidden) await prisma.appConfig.upsert({ where: { key }, create: { key, value: id }, update: { value: id } });
  else await prisma.appConfig.deleteMany({ where: { key } });
}

// Separate tracking intent from suggestion visibility: restoring a suggestion
// must never let legacy-project reconciliation silently enrol it again.
export function untrackedProjectKey(hostId: number | null, projectId: number) {
  return `inventory.untracked.${hostId ?? "local"}.${projectId}`;
}
export async function untrackedProjectIds(hostId: number | null) {
  const rows = await prisma.appConfig.findMany({ where: { key: { startsWith: `inventory.untracked.${hostId ?? "local"}.` } } });
  return new Set(rows.map((row) => Number(row.value)));
}
