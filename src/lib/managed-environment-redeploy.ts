import type { Project } from "@prisma/client";
import type { VpsConnection } from "./vps";
import {
  applyEnvToDeployment,
  inspectMaterializedEnvBundle,
  resolveDeploymentEnv,
} from "./env-management";

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
}

export function managedEnvironmentRedeployDecision(input: {
  hasProfile: boolean;
  runtimeReady: boolean;
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

  if (!input.materializedHash || input.materializedHash !== input.desiredHash) {
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

/**
 * Reconcile encrypted desired state with its ephemeral Docker delivery bundle.
 * The provider/database remains authoritative; generated env files and the
 * Compose override are reproducible artifacts.
 */
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
    });
  }

  const readiness = await inspectMaterializedEnvBundle(
    input.deployPath,
    resolved.profile.slug,
    resolved.values,
    resolved.componentValues,
    input.vps
  );
  const decision = managedEnvironmentRedeployDecision({
    hasProfile: true,
    runtimeReady: readiness.status === "materialized",
    desiredHash: resolved.validation.hash,
    materializedHash: resolved.profile.lastHash,
  });

  input.log?.(`${decision.evidence}\n`);
  if (readiness.missingScopes.length > 0) {
    input.log?.(`[configuration] Missing artifacts: ${readiness.missingScopes.join(", ")}\n`);
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
  }

  return {
    ...decision,
    profileId: resolved.profile.id,
    providerType: resolved.profile.providerType,
  };
}
