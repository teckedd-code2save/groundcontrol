import { findProjectSiteMatch, type RouteSite } from "./deployment-route-match";
import { linkDeploymentRuntime, type RuntimeContainerRecord } from "./deployment-runtime-link";
import type { ScannedProject } from "./project-scan";
import type { DockerContainerLabelInfo } from "./vps";

export interface DeploymentEvidenceInput {
  slug: string;
  sourcePath?: string | null;
  composePath?: string | null;
  containerName?: string | null;
  metadataJson?: string | null;
  savedDomain?: string | null;
  savedRepoUrl?: string | null;
  savedReleaseOutput?: string | null;
  savedProjectEnv?: string | null;
}

export type DeploymentExecutionIdentity = {
  sourcePath: string | null;
  composePath: string | null;
  composeProject: string | null;
  source: "runtime-label" | "saved-project" | "enrollment";
};

function normalizedIdentity(value?: string | null): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function firstComposeFile(value?: string | null): string | null {
  return String(value || "")
    .split(",")
    .map((file) => file.trim())
    .find((file) => file.startsWith("/") && /\.ya?ml$/i.test(file)) || null;
}

export function resolveDeploymentExecutionIdentity(
  deployment: DeploymentEvidenceInput & {
    legacyProjectPath?: string | null;
    legacyProjectSlug?: string | null;
  },
  labels: DockerContainerLabelInfo[],
  linkedContainerNames: string[] = []
): DeploymentExecutionIdentity {
  let metadataComposeProject = "";
  try {
    metadataComposeProject = String(
      (JSON.parse(deployment.metadataJson || "{}") as { composeProject?: unknown }).composeProject || ""
    );
  } catch {}
  const identities = new Set([
    deployment.slug,
    deployment.legacyProjectSlug,
    metadataComposeProject,
  ].map(normalizedIdentity).filter(Boolean));
  const linked = new Set(linkedContainerNames);
  const ranked = labels
    .map((label) => {
      let score = 0;
      if (linked.has(label.name) || deployment.containerName === label.name) score += 120;
      if (deployment.composePath && firstComposeFile(label.configFiles) === deployment.composePath) score += 100;
      if (deployment.legacyProjectPath && label.workingDir === deployment.legacyProjectPath) score += 90;
      if (deployment.sourcePath && label.workingDir === deployment.sourcePath) score += 80;
      if (identities.has(normalizedIdentity(label.project))) score += 70;
      if (identities.has(normalizedIdentity(label.workingDir.split("/").filter(Boolean).at(-1)))) score += 55;
      return { label, score };
    })
    .filter((candidate) => candidate.score > 0 && candidate.label.workingDir)
    .sort((a, b) => b.score - a.score);
  const runtime = ranked[0]?.label;
  if (runtime) {
    return {
      sourcePath: runtime.workingDir,
      composePath: firstComposeFile(runtime.configFiles) || deployment.composePath || null,
      composeProject: runtime.project || metadataComposeProject || null,
      source: "runtime-label",
    };
  }
  if (deployment.legacyProjectPath) {
    return {
      sourcePath: deployment.legacyProjectPath,
      composePath: deployment.composePath || null,
      composeProject: metadataComposeProject || null,
      source: "saved-project",
    };
  }
  return {
    sourcePath: deployment.sourcePath || null,
    composePath: deployment.composePath || null,
    composeProject: metadataComposeProject || null,
    source: "enrollment",
  };
}

export function readDeploymentOverrides(metadataJson?: string | null) {
  try {
    const parsed = JSON.parse(metadataJson || "{}") as {
      manualPublicUrl?: string;
      manualRepoUrl?: string;
      sourceRepair?: {
        defaultBranch?: string;
        deployedCommit?: string;
        sourceRoot?: string;
        daytonaEnabled?: boolean;
        daytonaConnectorId?: string;
        validationCommand?: string;
        regressionCommand?: string;
      };
    };
    return {
      publicUrl: typeof parsed.manualPublicUrl === "string" ? parsed.manualPublicUrl : null,
      repoUrl: typeof parsed.manualRepoUrl === "string" ? parsed.manualRepoUrl : null,
      sourceRepair: parsed.sourceRepair && typeof parsed.sourceRepair === "object" ? {
        defaultBranch: typeof parsed.sourceRepair.defaultBranch === "string" ? parsed.sourceRepair.defaultBranch : "",
        deployedCommit: typeof parsed.sourceRepair.deployedCommit === "string" ? parsed.sourceRepair.deployedCommit : "",
        sourceRoot: typeof parsed.sourceRepair.sourceRoot === "string" ? parsed.sourceRepair.sourceRoot : "",
        daytonaEnabled: parsed.sourceRepair.daytonaEnabled === true,
        daytonaConnectorId: typeof parsed.sourceRepair.daytonaConnectorId === "string" ? parsed.sourceRepair.daytonaConnectorId : "daytona",
        validationCommand: typeof parsed.sourceRepair.validationCommand === "string" ? parsed.sourceRepair.validationCommand : "",
        regressionCommand: typeof parsed.sourceRepair.regressionCommand === "string" ? parsed.sourceRepair.regressionCommand : "",
      } : null,
    };
  } catch {
    return { publicUrl: null, repoUrl: null, sourceRepair: null };
  }
}

export function readDeploymentSourceIdentity(...serializedRecords: Array<string | null | undefined>) {
  for (const serialized of serializedRecords) {
    if (!serialized) continue;
    for (const line of String(serialized).replace(/\r\n?/g, "\n").split("\n")) {
      if (!line.startsWith("__GC_SOURCE_FINGERPRINT__=")) continue;
      try {
        const fingerprint = JSON.parse(line.slice("__GC_SOURCE_FINGERPRINT__=".length)) as Record<string, unknown>;
        const repoUrl = typeof fingerprint.repoUrl === "string" && fingerprint.repoUrl.trim()
          ? fingerprint.repoUrl.trim()
          : null;
        const commitSha = typeof fingerprint.commitSha === "string" && fingerprint.commitSha.trim()
          ? fingerprint.commitSha.trim()
          : null;
        if (repoUrl || commitSha) return { repoUrl, commitSha };
      } catch {
        continue;
      }
    }
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(serialized) as Record<string, unknown>;
    } catch {
      continue;
    }
    const nestedManifest = typeof record.manifest === "string"
      ? (() => {
          try { return JSON.parse(record.manifest) as Record<string, unknown>; } catch { return null; }
        })()
      : record.manifest && typeof record.manifest === "object"
        ? record.manifest as Record<string, unknown>
        : null;
    const candidates = [record.source, nestedManifest?.source, record]
      .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"));
    for (const candidate of candidates) {
      const repoUrl = [candidate.repoUrl, candidate.repositoryUrl]
        .find((value): value is string => typeof value === "string" && value.trim().length > 0);
      const commitSha = [candidate.commitSha, candidate.deployedCommit]
        .find((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (repoUrl || commitSha) {
        return {
          repoUrl: repoUrl?.trim() || null,
          commitSha: commitSha?.trim() || null,
        };
      }
    }
  }
  return { repoUrl: null, commitSha: null };
}

export function resolveDeploymentEvidence(
  deployment: DeploymentEvidenceInput,
  containers: RuntimeContainerRecord[],
  labels: DockerContainerLabelInfo[],
  scannedProjects: ScannedProject[],
  sites: RouteSite[]
) {
  const runtime = linkDeploymentRuntime(deployment, containers, labels);
  const scanned = scannedProjects.find((project) => project.path === deployment.sourcePath)
    || scannedProjects.find((project) => project.slug === deployment.slug);
  const routeMatch = findProjectSiteMatch({
    slug: deployment.slug,
    dirName: deployment.sourcePath?.split("/").filter(Boolean).pop() || deployment.slug,
    path: deployment.sourcePath || scanned?.path || "",
    domain: deployment.savedDomain || scanned?.domain,
    services: scanned?.services || runtime.containers.map((container) => ({
      name: container.service || container.name,
      ports: [container.ports],
    })),
  }, sites, runtime.containers.map((container) => ({
    name: container.name,
    ports: container.ports,
    composeService: container.service || undefined,
  })));
  const overrides = readDeploymentOverrides(deployment.metadataJson);
  const recordedSource = readDeploymentSourceIdentity(
    deployment.savedReleaseOutput,
    deployment.savedProjectEnv
  );
  const discoveredUrl = routeMatch?.site.domain ? `https://${routeMatch.site.domain}` : null;
  const repoUrl = overrides.repoUrl || deployment.savedRepoUrl || recordedSource.repoUrl || null;
  const sourceCommit = overrides.sourceRepair?.deployedCommit || recordedSource.commitSha;
  return {
    runtime,
    route: routeMatch ? {
      ...routeMatch.site,
      confidence: routeMatch.confidence,
      score: routeMatch.score,
      evidence: routeMatch.evidence,
    } : null,
    publicUrl: overrides.publicUrl || (deployment.savedDomain ? `https://${deployment.savedDomain}` : null) || discoveredUrl,
    repoUrl,
    sourceCommit,
    sourceRepair: overrides.sourceRepair,
    identitySource: overrides.publicUrl || overrides.repoUrl
      ? "operator"
      : deployment.savedRepoUrl
        ? "saved-record"
        : recordedSource.repoUrl
          ? "release-record"
          : routeMatch
            ? "host-evidence"
            : "saved-record",
  };
}
