import { describe, expect, it } from "vitest";
import { managedEnvironmentRedeployDecision } from "./managed-environment-redeploy";

describe("managed environment redeploy policy", () => {
  it("rematerializes local GroundControl Vault values on every redeploy", () => {
    expect(managedEnvironmentRedeployDecision("local", true)).toEqual({
      action: "rematerialize-local",
      shouldMaterialize: true,
      evidence: "[configuration] Materializing the latest GroundControl Vault configuration",
    });
  });

  it("restores a remote-provider bundle when its runtime artifacts are missing", () => {
    expect(managedEnvironmentRedeployDecision("infisical", false)).toMatchObject({
      action: "restore-synchronized",
      shouldMaterialize: true,
    });
  });

  it("reuses a complete explicitly synchronized remote-provider bundle", () => {
    expect(managedEnvironmentRedeployDecision("infisical", true)).toMatchObject({
      action: "reuse-synchronized",
      shouldMaterialize: false,
    });
  });

  it("does nothing when the deployment has no managed environment", () => {
    expect(managedEnvironmentRedeployDecision(null, false)).toMatchObject({
      action: "none",
      shouldMaterialize: false,
    });
  });
});
