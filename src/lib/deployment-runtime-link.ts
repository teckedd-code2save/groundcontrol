import type { DockerContainerLabelInfo } from "./vps";

export interface RuntimeContainerRecord {
  name: string;
  image: string;
  status: string;
  ports: string;
  state: string;
}

export interface DeploymentRuntimeLink {
  status: "present" | "missing";
  confidence: "exact" | "strong" | "none";
  composeProject: string | null;
  containers: Array<RuntimeContainerRecord & { service: string | null; createdAt: string; startedAt: string; restartCount: number }>;
  evidence: string[];
}

function normalizeIdentityToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function linkDeploymentRuntime(
  deployment: {
    sourcePath?: string | null;
    containerName?: string | null;
    metadataJson?: string | null;
    legacyProjectPath?: string | null;
    legacyProjectSlug?: string | null;
  },
  containers: RuntimeContainerRecord[],
  labels: DockerContainerLabelInfo[]
): DeploymentRuntimeLink {
  let composeProject = "";
  try {
    const metadata = JSON.parse(deployment.metadataJson || "{}") as { composeProject?: string };
    composeProject = metadata.composeProject || "";
  } catch {}

  const matches = containers.flatMap((container) => {
    const label = labels.find((candidate) => candidate.name === container.name);
    const exactContainer = deployment.containerName === container.name;
    const exactWorkingDir = Boolean(deployment.sourcePath && label?.workingDir === deployment.sourcePath);
    const configUnderSource = Boolean(deployment.sourcePath && label?.configFiles
      ?.split(",").some((file) => file === deployment.sourcePath || file.startsWith(`${deployment.sourcePath}/`)));
    const exactProject = Boolean(composeProject && label?.project === composeProject);
    const exactLegacyWorkingDir = Boolean(deployment.legacyProjectPath && label?.workingDir === deployment.legacyProjectPath);
    const configUnderLegacy = Boolean(deployment.legacyProjectPath && label?.configFiles
      ?.split(",").some((file) => file === deployment.legacyProjectPath || file.startsWith(`${deployment.legacyProjectPath}/`)));
    const exactLegacyProject = Boolean(
      deployment.legacyProjectSlug &&
      (
        (label?.project && normalizeIdentityToken(label.project) === normalizeIdentityToken(deployment.legacyProjectSlug)) ||
        (label?.projectSlug && normalizeIdentityToken(label.projectSlug) === normalizeIdentityToken(deployment.legacyProjectSlug))
      )
    );
    if (
      !exactContainer &&
      !exactWorkingDir &&
      !configUnderSource &&
      !exactProject &&
      !exactLegacyWorkingDir &&
      !configUnderLegacy &&
      !exactLegacyProject
    ) return [];
    return [{
      ...container,
      service: label?.service || null,
      createdAt: label?.createdAt || "",
      startedAt: label?.startedAt || "",
      restartCount: label?.restartCount || 0,
      label,
      exactContainer,
      exactWorkingDir,
      exactProject,
      exactLegacyWorkingDir,
      exactLegacyProject,
    }];
  });

  const matchedProject = matches.find((item) => item.label?.project)?.label?.project || composeProject || null;
  const exact = matches.some((item) =>
    item.exactContainer ||
    item.exactWorkingDir ||
    item.exactProject ||
    item.exactLegacyWorkingDir ||
    item.exactLegacyProject
  );
  return {
    status: matches.length ? "present" : "missing",
    confidence: matches.length ? (exact ? "exact" : "strong") : "none",
    composeProject: matchedProject,
    containers: matches.map(({
      label: _label,
      exactContainer: _a,
      exactWorkingDir: _b,
      exactProject: _c,
      exactLegacyWorkingDir: _d,
      exactLegacyProject: _e,
      ...item
    }) => item),
    evidence: [
      deployment.containerName && matches.some((item) => item.exactContainer) ? `Container ${deployment.containerName}` : null,
      deployment.sourcePath && matches.some((item) => item.exactWorkingDir) ? `Compose working directory ${deployment.sourcePath}` : null,
      deployment.legacyProjectPath && matches.some((item) => item.exactLegacyWorkingDir) ? `Project working directory ${deployment.legacyProjectPath}` : null,
      deployment.legacyProjectSlug && matches.some((item) => item.exactLegacyProject) ? `Project identity ${deployment.legacyProjectSlug}` : null,
      matchedProject ? `Compose project ${matchedProject}` : null,
      matches.length ? `${matches.length} runtime container${matches.length === 1 ? "" : "s"}` : null,
    ].filter((item): item is string => Boolean(item)),
  };
}
