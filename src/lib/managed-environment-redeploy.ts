export type ManagedEnvironmentRedeployAction =
  | "none"
  | "rematerialize-local"
  | "restore-synchronized"
  | "reuse-synchronized";

export interface ManagedEnvironmentRedeployDecision {
  action: ManagedEnvironmentRedeployAction;
  shouldMaterialize: boolean;
  evidence: string;
}

/**
 * Decide how a redeploy prepares its managed environment.
 *
 * GroundControl Vault is the source of truth for local environments, so every
 * redeploy must regenerate `.env` and component files from the latest saved
 * values. Merely finding yesterday's manifest is not proof that the runtime
 * bundle contains today's configuration.
 *
 * Remote providers are synchronized explicitly. Routine redeploys may reuse a
 * complete synchronized bundle, but must rebuild it when any managed artifact
 * is missing.
 */
export function managedEnvironmentRedeployDecision(
  providerType: string | null | undefined,
  bundleReady: boolean
): ManagedEnvironmentRedeployDecision {
  if (!providerType) {
    return {
      action: "none",
      shouldMaterialize: false,
      evidence: "[configuration] Using the Compose defaults",
    };
  }

  if (providerType === "local") {
    return {
      action: "rematerialize-local",
      shouldMaterialize: true,
      evidence: "[configuration] Materializing the latest GroundControl Vault configuration",
    };
  }

  if (!bundleReady) {
    return {
      action: "restore-synchronized",
      shouldMaterialize: true,
      evidence: "[configuration] Restoring the synchronized deployment configuration",
    };
  }

  return {
    action: "reuse-synchronized",
    shouldMaterialize: false,
    evidence: "[configuration] Reusing the synchronized deployment configuration",
  };
}
