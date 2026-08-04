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

export type ManagedEnvironmentFailureCode =
  | "ENV_RUNTIME_DIRECTORY"
  | "ENV_PERMISSION_DENIED"
  | "ENV_STORAGE_FULL"
  | "ENV_READ_ONLY_FILESYSTEM"
  | "ENV_DECRYPTION_FAILED"
  | "ENV_SERIALIZATION_FAILED"
  | "ENV_MATERIALIZATION_FAILED"
  | "ENV_VERIFICATION_FAILED";

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
  missingArtifacts?: string[];
  changedArtifacts?: string[];
  missingValueWarnings?: string[];
  recovered?: boolean;
}

export interface ExpectedManagedEnvironmentArtifact {
  scope: string;
  path: string;
  hash: string;
}

export interface ManagedEnvironmentArtifactInspection {
  missingArtifacts: string[];
  changedArtifacts: string[];
  mismatchedArtifacts: string[];
  runtimeReady: boolean;
  bundleMatchesDesired: boolean;
}

export interface ManagedEnvironmentFailureDiagnosis {
  code: ManagedEnvironmentFailureCode;
  summary: string;
  remediation: string;
  automaticallyRecoverable: boolean;
}

export class ManagedEnvironmentPreparationError extends Error {
  constructor(
    public readonly code: ManagedEnvironmentFailureCode,
    message: string,
    public readonly remediation: string,
    public readonly previousDeploymentPreserved = true,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ManagedEnvironmentPreparationError";
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeServiceName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Managed environment preparation failed");
}

export function diagnoseManagedEnvironmentFailure(error: unknown): ManagedEnvironmentFailureDiagnosis {
  const detail = errorText(error).toLowerCase();
  if (/no space left on device|disk quota exceeded|enospc|inode/.test(detail)) {
    return {
      code: "ENV_STORAGE_FULL",
      summary: "The host has insufficient storage to write the deployment environment.",
      remediation: "Free disk space or inodes on the target host, then redeploy. GroundControl did not replace the active deployment.",
      automaticallyRecoverable: false,
    };
  }
  if (/read-only file system|erofs/.test(detail)) {
    return {
      code: "ENV_READ_ONLY_FILESYSTEM",
      summary: "The deployment filesystem is read-only.",
      remediation: "Restore the target mount to read-write mode, then redeploy. GroundControl did not replace the active deployment.",
      automaticallyRecoverable: false,
    };
  }
  if (/decrypt|decryption|authentication tag|unsupported state/.test(detail)) {
    return {
      code: "ENV_DECRYPTION_FAILED",
      summary: "GroundControl could not decrypt one or more managed values.",
      remediation: "Check the GroundControl encryption key and key-rotation history. The affected values were not replaced with empty strings.",
      automaticallyRecoverable: false,
    };
  }
  if (/permission denied|operation not permitted|eacces|eperm/.test(detail)) {
    return {
      code: "ENV_PERMISSION_DENIED",
      summary: "GroundControl could not write to its managed environment directory.",
      remediation: "GroundControl will repair its owned directory and permissions once, then retry automatically.",
      automaticallyRecoverable: true,
    };
  }
  if (/no such file or directory|enoent|cannot create directory|not a directory/.test(detail)) {
    return {
      code: "ENV_RUNTIME_DIRECTORY",
      summary: "The managed environment runtime directory is missing or incomplete.",
      remediation: "GroundControl will recreate its owned runtime directory, remove abandoned temporary files, and retry once.",
      automaticallyRecoverable: true,
    };
  }
  if (/serialize|invalid dotenv|invalid environment|malformed/.test(detail)) {
    return {
      code: "ENV_SERIALIZATION_FAILED",
      summary: "GroundControl could not serialize the managed environment safely.",
      remediation: "The candidate deployment was stopped before Docker changes. Review the generated configuration evidence.",
      automaticallyRecoverable: false,
    };
  }
  return {
    code: "ENV_MATERIALIZATION_FAILED",
    summary: "GroundControl could not materialize the managed environment.",
    remediation: "The candidate deployment was stopped before Docker changes. Review host access and the deployment evidence, then retry.",
    automaticallyRecoverable: false,
  };
}

export function expectedManagedEnvironmentArtifacts(input: {
  deployPath: string;
  environmentSlug: string;
  values: Record<string, string>;
  componentValues: Record<string, Record<string, string>>;
}): ExpectedManagedEnvironmentArtifact[] {
  const runtimeDir = managedEnvRuntimeDirectory(input.deployPath, input.environmentSlug);
  const interpolationValues = composeInterpolationValues(input.values, input.componentValues);
  const components = Object.keys(input.componentValues)
    .filter(safeServiceName)
    .filter((component) => Object.keys(input.componentValues[component]).length > 0)
    .sort();
  const artifacts: ExpectedManagedEnvironmentArtifact[] = [];

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
      { scope: "runtime manifest", path: `${input.deployPath}/${MANAGED_ENV_FILES_MANIFEST}`, hash: sha256(manifest) },
      { scope: "Compose environment overlay", path: `${input.deployPath}/${MANAGED_ENV_OVERRIDE_FILE}`, hash: sha256(override) }
    );
  }

  return artifacts;
}

export function buildInspectManagedEnvironmentArtifactsCommand(
  artifacts: ExpectedManagedEnvironmentArtifact[]
): string {
  if (artifacts.length === 0) return "true";
  return artifacts.map((artifact) => [
    `if [ ! -f ${shQuote(artifact.path)} ]; then`,
    `  printf '%s\\n' ${shQuote(`missing|${artifact.scope}`)}`,
    "else",
    `  actual=$(sha256sum ${shQuote(artifact.path)} 2>/dev/null | awk '{print $1}' || shasum -a 256 ${shQuote(artifact.path)} | awk '{print $1}')`,
    `  [ \"$actual\" = ${shQuote(artifact.hash)} ] || printf '%s\\n' ${shQuote(`changed|${artifact.scope}`)}`,
    "fi",
  ].join("\n")).join("\n");
}

export function buildManagedEnvironmentRecoveryCommand(deployPath: string, environmentSlug: string): string {
  const runtimeDir = managedEnvRuntimeDirectory(deployPath, environmentSlug);
  return [
    "set -eu",
    `mkdir -p ${shQuote(deployPath)} ${shQuote(runtimeDir)}`,
    `chmod 700 ${shQuote(runtimeDir)}`,
    `find ${shQuote(runtimeDir)} -maxdepth 1 -type f -name '*.new' -delete 2>/dev/null || true`,
    `find ${shQuote(deployPath)} -maxdepth 1 -type f -name '*.new' -delete 2>/dev/null || true`,
    `probe=${shQuote(`${runtimeDir}/.groundcontrol-write-probe`)}`,
    `: > "$probe"`,
    `chmod 600 "$probe"`,
    `rm -f "$probe"`,
  ].join("\n");
}

export function inspectManagedEnvironmentArtifactOutput(
  output: string,
  commandSucceeded: boolean,
  artifacts: ExpectedManagedEnvironmentArtifact[]
): ManagedEnvironmentArtifactInspection {
  if (!commandSucceeded) {
    const missingArtifacts = artifacts.map((artifact) => artifact.scope);
    return {
      missingArtifacts,
      changedArtifacts: [],
      mismatchedArtifacts: missingArtifacts,
      runtimeReady: false,
      bundleMatchesDesired: false,
    };
  }

  const missingArtifacts: string[] = [];
  const changedArtifacts: string[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const separator = line.indexOf("|");
    if (separator < 1) continue;
    const kind = line.slice(0, separator);
    const scope = line.slice(separator + 1);
    if (!scope) continue;
    if (kind === "missing") missingArtifacts.push(scope);
    if (kind === "changed") changedArtifacts.push(scope);
  }

  const mismatchedArtifacts = [...missingArtifacts, ...changedArtifacts];
  return {
    missingArtifacts,
    changedArtifacts,
    mismatchedArtifacts,
    runtimeReady: missingArtifacts.length === 0,
    bundleMatchesDesired: mismatchedArtifacts.length === 0,
  };
}

export function managedEnvironmentRedeployDecision(input: {
  hasProfile: boolean;
  runtimeReady: boolean;
  bundleMatchesDesired: boolean;
  desiredHash?: string;
  materializedHash?: string | null;
}): ManagedEnvironmentRedeployDecision {
  if (!input.hasProfile) {
    return { action: "none", shouldMaterialize: false, evidence: "[configuration] Using the Compose defaults" };
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

async function materializeWithBoundedRecovery(input: {
  project: Project;
  deploymentId?: number;
  components?: string[];
  environmentSlug: string;
  vps?: VpsConnection | null;
  log?: (chunk: string) => void;
}): Promise<boolean> {
  const materialize = () => applyEnvToDeployment(input.project, input.deploymentId, input.log, {
    materialize: true,
    components: input.components,
    environmentSlug: input.environmentSlug,
    vps: input.vps,
  });

  try {
    await materialize();
    return false;
  } catch (error) {
    const diagnosis = diagnoseManagedEnvironmentFailure(error);
    input.log?.(`[configuration] materialization failed code=${diagnosis.code}\n`);
    if (!diagnosis.automaticallyRecoverable) {
      throw new ManagedEnvironmentPreparationError(
        diagnosis.code,
        diagnosis.summary,
        diagnosis.remediation,
        true,
        { cause: error }
      );
    }

    input.log?.(`[configuration] automatic recovery: ${diagnosis.remediation}\n`);
    const repair = await execOnTargetStrict(
      buildManagedEnvironmentRecoveryCommand(input.project.path || "", input.environmentSlug),
      input.vps
    );
    if (repair.code !== 0) {
      const repairDiagnosis = diagnoseManagedEnvironmentFailure(repair.stderr || repair.stdout);
      throw new ManagedEnvironmentPreparationError(
        repairDiagnosis.code,
        repairDiagnosis.summary,
        repairDiagnosis.remediation,
        true,
        { cause: error }
      );
    }

    try {
      await materialize();
      input.log?.("[configuration] automatic recovery succeeded\n");
      return true;
    } catch (retryError) {
      const retryDiagnosis = diagnoseManagedEnvironmentFailure(retryError);
      throw new ManagedEnvironmentPreparationError(
        retryDiagnosis.code,
        retryDiagnosis.summary,
        `${retryDiagnosis.remediation} Automatic recovery was attempted once and did not succeed.`,
        true,
        { cause: retryError }
      );
    }
  }
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

  // Legacy and discovered schemas can mark optional integrations as required.
  // Keep these gaps visible, but do not block deployment until requiredness is
  // explicitly derived from Compose interpolation semantics or user intent.
  const missingValueWarnings = resolved.validation.ok ? [] : resolved.validation.missing;
  if (missingValueWarnings.length > 0) {
    input.log?.(`[configuration] warning: optional or unconfirmed values are not configured: ${missingValueWarnings.join(", ")}\n`);
  }

  const artifacts = expectedManagedEnvironmentArtifacts({
    deployPath: input.deployPath,
    environmentSlug: resolved.profile.slug,
    values: resolved.values,
    componentValues: resolved.componentValues,
  });
  const inspectionResult = await execOnTargetStrict(
    buildInspectManagedEnvironmentArtifactsCommand(artifacts),
    input.vps
  );
  const inspection = inspectManagedEnvironmentArtifactOutput(
    inspectionResult.stdout,
    inspectionResult.code === 0,
    artifacts
  );
  const decision = managedEnvironmentRedeployDecision({
    hasProfile: true,
    runtimeReady: inspection.runtimeReady,
    bundleMatchesDesired: inspection.bundleMatchesDesired,
    desiredHash: resolved.validation.hash,
    materializedHash: resolved.profile.lastHash,
  });

  input.log?.(`${decision.evidence}\n`);
  if (inspection.mismatchedArtifacts.length > 0) {
    input.log?.(`[configuration] Reconcile: ${inspection.mismatchedArtifacts.join(", ")}\n`);
  }

  let recovered = false;
  if (decision.shouldMaterialize) {
    recovered = await materializeWithBoundedRecovery({
      project,
      deploymentId: input.deploymentId,
      components: input.components,
      environmentSlug: resolved.profile.slug,
      vps: input.vps,
      log: input.log,
    });

    const verificationResult = await execOnTargetStrict(
      buildInspectManagedEnvironmentArtifactsCommand(artifacts),
      input.vps
    );
    const verification = inspectManagedEnvironmentArtifactOutput(
      verificationResult.stdout,
      verificationResult.code === 0,
      artifacts
    );
    if (!verification.bundleMatchesDesired) {
      throw new ManagedEnvironmentPreparationError(
        "ENV_VERIFICATION_FAILED",
        "GroundControl generated the managed environment, but the resulting artifacts did not match the desired revision.",
        `The candidate deployment was stopped before Docker changes. Mismatched artifacts: ${verification.mismatchedArtifacts.join(", ") || "unknown"}.`,
        true
      );
    }
  }

  return {
    ...decision,
    profileId: resolved.profile.id,
    providerType: resolved.profile.providerType,
    mismatchedArtifacts: inspection.mismatchedArtifacts,
    missingArtifacts: inspection.missingArtifacts,
    changedArtifacts: inspection.changedArtifacts,
    missingValueWarnings,
    recovered,
  };
}
