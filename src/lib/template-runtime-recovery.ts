import type { DockerContainerLabelInfo } from "./vps";

/** Only the historical UI fallback for a generated template identity is recoverable. */
export function templateRuntimeRecovery(deployment: {
  slug: string; kind: string; managementMode: string; sourcePath: string | null;
  composePath: string | null; metadataJson: string;
}, labels: DockerContainerLabelInfo[]) {
  let metadata: Record<string, unknown>;
  try { metadata = JSON.parse(deployment.metadataJson); } catch { return null; }
  const expected = `gc_${deployment.slug.replace(/-/g, "_")}`.slice(0, 63);
  if (deployment.kind !== "compose" || deployment.managementMode !== "managed"
    || metadata.source !== "template" || metadata.composeProject !== expected
    || !deployment.sourcePath || !deployment.composePath
    || deployment.sourcePath.split("/").at(-1) !== deployment.slug
    || labels.some(label => label.project === expected)) return null;
  const candidates = labels.filter(label => label.workingDir === deployment.sourcePath);
  if (!candidates.length || candidates.some(label => label.project !== deployment.slug
    || !label.configFiles.split(",").map(file => file.trim()).includes(deployment.composePath!))) return null;
  return { composeProject: deployment.slug, containers: candidates.map(label => label.name).sort() };
}
