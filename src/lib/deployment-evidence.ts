import { findProjectSiteMatch, type RouteSite } from "./deployment-route-match";
import { linkDeploymentRuntime, type RuntimeContainerRecord } from "./deployment-runtime-link";
import type { ScannedProject } from "./project-scan";
import type { DockerContainerLabelInfo } from "./vps";

export interface DeploymentEvidenceInput {
  slug: string;
  sourcePath?: string | null;
  containerName?: string | null;
  metadataJson?: string | null;
  savedDomain?: string | null;
  savedRepoUrl?: string | null;
}

export function readDeploymentOverrides(metadataJson?: string | null) {
  try {
    const parsed = JSON.parse(metadataJson || "{}") as { manualPublicUrl?: string; manualRepoUrl?: string };
    return {
      publicUrl: typeof parsed.manualPublicUrl === "string" ? parsed.manualPublicUrl : null,
      repoUrl: typeof parsed.manualRepoUrl === "string" ? parsed.manualRepoUrl : null,
    };
  } catch {
    return { publicUrl: null, repoUrl: null };
  }
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
  const discoveredUrl = routeMatch?.site.domain ? `https://${routeMatch.site.domain}` : null;
  return {
    runtime,
    route: routeMatch ? {
      ...routeMatch.site,
      confidence: routeMatch.confidence,
      score: routeMatch.score,
      evidence: routeMatch.evidence,
    } : null,
    publicUrl: overrides.publicUrl || (deployment.savedDomain ? `https://${deployment.savedDomain}` : null) || discoveredUrl,
    repoUrl: overrides.repoUrl || deployment.savedRepoUrl || null,
    identitySource: overrides.publicUrl || overrides.repoUrl ? "operator" : routeMatch ? "host-evidence" : "saved-record",
  };
}
