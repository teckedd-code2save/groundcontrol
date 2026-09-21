export type GithubAutoDeployPolicy = {
  enabled: boolean;
  branch: string;
};

export function branchFromPushRef(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith("refs/heads/")) return null;
  const branch = ref.slice("refs/heads/".length).trim();
  return branch && branch.length <= 200 ? branch : null;
}

export function readGithubAutoDeployPolicy(metadataJson: string | null | undefined): GithubAutoDeployPolicy {
  try {
    const metadata = JSON.parse(metadataJson || "{}") as {
      sourceRepair?: { defaultBranch?: unknown; autoDeployEnabled?: unknown };
    };
    const source = metadata.sourceRepair;
    return {
      enabled: source?.autoDeployEnabled === true,
      branch: typeof source?.defaultBranch === "string" && source.defaultBranch.trim()
        ? source.defaultBranch.trim()
        : "main",
    };
  } catch {
    return { enabled: false, branch: "main" };
  }
}

export function grantCanDeploy(scope: string, resources: string, deploymentId: number): boolean {
  const scopes = new Set(String(scope || "").split(/\s+/).filter(Boolean));
  if (!scopes.has("deployment:redeploy")) return false;
  try {
    const parsed = JSON.parse(resources || "[]");
    return Array.isArray(parsed) && parsed.map(Number).includes(deploymentId);
  } catch {
    return false;
  }
}

export function githubAutoDeployIdempotencyKey(deliveryId: string, deploymentId: number): string {
  return `github-push:${deliveryId}:${deploymentId}`;
}
