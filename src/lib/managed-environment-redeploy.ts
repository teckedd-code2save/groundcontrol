import { createHash } from "crypto";
import type { Project } from "@prisma/client";
import type { VpsConnection } from "./vps";
import { shQuote } from "./vps";
import { execOnTargetStrict } from "./host-exec";
import {
  applyEnvToDeployment,
  composeInterpolationValues,
  managedEnvRuntimeDirectory,
  resolveDeploymentEnv,
  serializeDotenv,
} from "./env-management";
import {
  MANAGED_ENV_FILES_MANIFEST,
  MANAGED_ENV_OVERRIDE_FILE,
} from "./compose-management";

export type ManagedEnvironmentRedeployAction =
  | "none"
  | "reuse-current"
  | "materialize-missing"
  | "materialize-changed";

export interface ManagedEnvironmentRedeployDecision {
  action: ManagedEnvironmentRedeployAction;
  shouldMaterialize: boolean;
  desiredHash?: string;
  materializedHash?: string | null;
  evidence: string;
}

export interface ReconcileManagedEnvironmentResult extends ManagedEnvironmentRedeployDecision {
  profileId?: number;
  providerType?: string;
  mismatchedArtifacts?: string[];
}

interface ExpectedArtifact {
  scope: string;
  path: string;
  hash: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeServiceName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

export function expectedManagedEnvironmentArtifacts(input: {
  deployPath: string;
  environmentSlug: string;
  values: Record<string, string>;
  componentValues: Record<string, Record<string, string>>;
}): ExpectedArtifact[] {
  const runtimeDir = managedEnvRuntimeDirectory(input.deployPath, input.environmentSlug);
  const interpolationValues = composeInterpolationValues(input.values, input.componentValues);
  const components = Object.keys(input.componentValues)
    .filter(safeServiceName)
    .filter((component) => Object.keys(input.componentValues[component]).length > 0)
    .sort();
  const artifacts: ExpectedArtifact[] = [];

  if (Object.keys(interpolationValues).length > 0) {
    artifacts.push({
      scope: "deployment environment",
      path: `${input.deployPath}/.env`,
      hash: sha256(serializeDotenv(interpolationValues)),
    });
  }

  for (const component of components) {
    artifacts.push({
      scope: `${component} environment`,
      path: `${runtimeDir}/${component}.env`,
      hash: sha256(serializeDotenv(input.componentValues[component])),
    });
  }

  if (components.length > 0) {
    const runtimeFiles = components.map((component) => `${runtimeDir}/${component}.env`);
    const manifest = runtimeFiles.join("\n") + "\n";
    const override = [
      "# Managed by GroundControl. Source values remain encrypted in GroundControl.",
      "services:",
      ...components.flatMap((component) => [
        `  ${component}:`,
        "    env_file:",
        `      - ${runtimeDir}/${component}.env`,
      ]),
      "",
    ].join("\n");
    artifacts.push(
      {
        scope: "runtime manifest",
        path: `${input.deployPath}/${MANAGED_ENV_FILES_MANIFEST}`,
        hash: sha256(manifest),
      },
      {
        scope: "Compose environment overlay",
        path: `${input.deployPath}/${MANAGED_ENV_OVERRIDE_FILE}`,
        hash: sha256(override),
      }
    );
  }

  return artifacts;
}

export function buildInspectManagedEnvironmentArtifactsCommand(artifacts: ExpectedArtifact[]): string {
  if (artifacts.length === 0) return "true";
  return artifacts.map((artifact) => [
    `if [ ! -f ${shQuote(artifact.path)} ]; then`,
    `  printf '%s\\n' ${shQuote(artifact.scope)}`,
    "else",
    `  actual=$(sha256sum ${shQuote(artifact.path)} 2>/dev/null | awk '{print $1}' || shasum -a 256 ${shQuote(artifact.path)} | awk '{print $1}')`,
    `  [ \"$actual\" = ${shQuote(artifact.hash)} ] || printf '%s\\n' ${shQuote(artifact.scope)}`,
    "fi",
  ].join("\n")).join("\n");
}

export function managedEnvironmentRedeployDecision(input: {
  hasProfile: boolean;
  runtimeReady: boolean;
  bundleMatchesDesired: boolean;
  desiredHash?: string;
  materializedHash?: string | null;
}): ManagedEnvironmentRedeployDecision {
  if (!input.hasProfile) {
    return {
      action: "none",
      shouldMaterialize: false,
      evidence: "[configuration] Using the Compose defaults",
    };
  }

  if (!input.runtimeReady) {
    return {
      action: "materialize-missing",
      shouldMaterialize: true,
      desiredHash: input.desiredHash,
      materializedHash: input.materializedHash,
      evidence: "[configuration] Restoring missing managed environment artifacts",
    };
  }

  if (!input.bundleMatchesDesired) {
    return {
      action: "materialize-changed",
      shouldMaterialize: true,
      desiredHash: input.desiredHash,
      materializedHash: input.materializedHash,
      evidence: "[configuration] Applying the latest managed environment revision",
    };
  }

  return {
    action: "reuse-current",
    shouldMaterialize: false,
    desiredHash: input.desiredHash,
    materializedHash: input.materializedHash,
    evidence: "[configuration] Managed environment revision is current",
  };
}

export async function reconcileManagedEnvironmentForRedeploy(input: {
  project: Project;
  deployPath: string;
  deploymentId?: number;
  components?: string[];
  environmentSlug?: string;
  vps?: VpsConnection | null;
  log?: (chunk: string) => void;
}): Promise<ReconcileManagedEnvironmentResult> {
  const project = { ...input.project, path: input.deployPath };
  const resolved = await resolveDeploymentEnv(project, input.environmentSlug);
  if (!resolved) {
    return managedEnvironmentRedeployDecision({
      hasProfile: false,
      runtimeReady: false,
      bundleMatchesDesired: false,
    });
  }

  const artifacts = expectedManagedEnvironmentArtifacts({
    deployPath: input.deployPath,
    environmentSlug: resolved.profile.slug,
    values: resolved.values,
    componentValues: resolved.componentValues,
  });
  const inspection = await execOnTargetStrict(
    buildInspectManagedEnvironmentArtifactsCommand(artifacts),
    input.vps
  );
  const mismatchedArtifacts = inspection.code === 0
    ? inspection.stdout.split("\n").map((item) => item.trim()).filter(Boolean)
    : artifacts.map((artifact) => artifact.scope);
  const runtimeReady = artifacts.length === 0 || mismatchedArtifacts.length < artifacts.length;
  const bundleMatchesDesired = inspection.code === 0 && mismatchedArtifacts.length === 0;
  const decision = managedEnvironmentRedeployDecision({
    hasProfile: true,
    runtimeReady,
    bundleMatchesDesired,
    desiredHash: resolved.validation.hash,
    materializedHash: resolved.profile.lastHash,
  });

  input.log?.(`${decision.evidence}\n`);
  if (mismatchedArtifacts.length > 0) {
    input.log?.(`[configuration] Reconcile: ${mismatchedArtifacts.join(", ")}\n`);
  }

  if (decision.shouldMaterialize) {
    await applyEnvToDeployment(
      project,
      input.deploymentId,
      input.log,
      {
        materialize: true,
        components: input.components,
        environmentSlug: resolved.profile.slug,
        vps: input.vps,
      }
    );

    const verification = await execOnTargetStrict(
      buildInspectManagedEnvironmentArtifactsCommand(artifacts),
      input.vps
    );
    const remaining = verification.stdout.split("\n").map((item) => item.trim()).filter(Boolean);
    if (verification.code !== 0 || remaining.length > 0) {
      throw new Error(`Managed environment verification failed: ${remaining.join(", ") || verification.stderr || "artifact checksum mismatch"}`);
    }
  }

  return {
    ...decision,
    profileId: resolved.profile.id,
    providerType: resolved.profile.providerType,
    mismatchedArtifacts,
  };
}
