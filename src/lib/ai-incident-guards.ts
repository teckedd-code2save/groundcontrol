import type { ToolCallRecord } from "./ai-memory";

export interface IncidentContext {
  domain: string;
  deploymentSlug: string;
  sourcePath?: string | null;
  composePath?: string | null;
  repository?: string | null;
  deployedCommit?: string | null;
  sourceRoot?: string | null;
  validationCommand?: string | null;
  regressionCommand?: string | null;
  daytonaEnabled?: boolean;
  failureBoundary?: string | null;
  inspectionSummary?: string | null;
  inspectionCause?: string | null;
  proxyUpstream?: string | null;
  runtimeStatus?: string | null;
  containers?: string[];
  composeServices?: string[];
}

export function shouldBlockIncidentConfirmation(
  name: string,
  incidentContext?: IncidentContext
): string | null {
  if (!incidentContext) return null;
  const boundary = String(incidentContext.failureBoundary || "").trim();
  const summary = String(incidentContext.inspectionSummary || "").trim();
  const cause = String(incidentContext.inspectionCause || "").trim();
  if (name === "reconcile_compose_route_port" && boundary === "application") {
    return [
      "Blocked route-port repair: deterministic diagnosis classified this as an application/service-contract failure, not proxy port drift.",
      summary ? `Diagnosis: ${summary}` : "",
      cause ? `Evidence: ${cause}` : "",
      "Expected path: inspect the deployed source/config contract, validate the repair, then redeploy and verify the public endpoint.",
    ].filter(Boolean).join("\n");
  }
  if (name === "restart_container" && boundary === "application" && /contract|depends|health|port/i.test(`${summary} ${cause}`)) {
    return [
      "Blocked container restart: deterministic diagnosis points to a service contract mismatch.",
      "A restart will recreate the same bad runtime unless the source/config/env contract is repaired first.",
    ].join("\n");
  }
  return null;
}

const SOURCE_REPAIR_TOOLS = new Set([
  "read_repository_source_at_revision",
  "prepare_source_fix_in_daytona",
  "reproduce_incident_in_daytona",
]);

function isSourceRepairTool(name: string) {
  return SOURCE_REPAIR_TOOLS.has(name);
}

function sourceIdentityBlockerText(
  incidentContext: IncidentContext | undefined,
  reason: string
) {
  const deployment = incidentContext?.deploymentSlug || "this deployment";
  const repo = incidentContext?.repository || "unlinked";
  const revision = incidentContext?.deployedCommit || "unresolved";
  const repoLinked = repo !== "unlinked";
  const revisionLinked = /^[a-f0-9]{40,64}$/i.test(revision);
  const fix = !repoLinked
    ? `Link the deployment's GitHub repository in the deployment Configure tab. Current source identity: repository ${repo}, deployed revision ${revision}.`
    : !revisionLinked
      ? `The repository is already linked: ${repo}. Set the exact deployed commit in the deployment Configure tab, or redeploy through GroundControl so the release records it. Current deployed revision: ${revision}.`
      : `The repository and deployed commit are recorded, but GroundControl could not read the requested source. Check the repository-relative path, file path, GitHub App installation access, and that commit ${revision} exists in ${repo}.`;
  return [
    "### Problem",
    `Source repair is blocked because GroundControl cannot read the exact repository revision for ${deployment}.`,
    "",
    "### Fix",
    `${fix} ${reason}`,
    "",
    "### Verify",
    "After the source identity is corrected, continue this investigation. GroundControl should read the target file from the recorded revision, validate the repair in Daytona, then prepare a confirmation-gated PR.",
  ].join("\n");
}

export function hasSourceIdentityBlocker(toolCalls: Pick<ToolCallRecord, "name" | "output">[], content: string) {
  const combined = [
    content,
    ...toolCalls.filter((call) => isSourceRepairTool(call.name)).map((call) => call.output || ""),
  ].join("\n");
  return /Source repair is blocked because GroundControl cannot read the exact repository revision/i.test(combined);
}

export function shouldBlockIncidentSourceTool(
  name: string,
  args: Record<string, unknown>,
  incidentContext?: IncidentContext,
  output?: string
): string | null {
  if (!incidentContext || !isSourceRepairTool(name)) return null;
  const repository = String(args.repositoryUrl || incidentContext.repository || "").trim();
  const commit = String(args.commitSha || incidentContext.deployedCommit || "").trim();
  if (!repository) {
    return sourceIdentityBlockerText(
      incidentContext,
      "No repository URL is stored on the deployment, so GroundControl will not guess from folder names or container labels."
    );
  }
  if (name !== "reproduce_incident_in_daytona" && !/^[a-f0-9]{40,64}$/i.test(commit)) {
    return sourceIdentityBlockerText(
      incidentContext,
      "The deployed commit is missing or is not an exact SHA, so GroundControl cannot prove a source change against the running revision."
    );
  }
  if (output && /deployed revision [a-f0-9]{12}.*not reachable|Record the exact Git commit/i.test(output)) {
    return sourceIdentityBlockerText(
      incidentContext,
      "The recorded deployed revision is not reachable in the linked GitHub repository. Record the exact Git commit that produced the running image, or redeploy through GroundControl so it captures the source fingerprint."
    );
  }
  if (output && /source file .* was not found|Check the deployment source path|Set the deployment source path/i.test(output)) {
    return sourceIdentityBlockerText(
      incidentContext,
      "The requested source file was not found at the deployed revision. Check the deployment source path and file path before attempting a Daytona repair."
    );
  }
  if (output && /GitHub API request failed\s*\(404\)|\b404\b.*\bgithub\b|not\s+found/i.test(output)) {
    return sourceIdentityBlockerText(
      incidentContext,
      "The stored repository, file path, or deployed revision was not readable through the connected GitHub App."
    );
  }
  return null;
}

