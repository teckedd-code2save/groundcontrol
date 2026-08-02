import { describe, expect, it } from "vitest";
import { managedEnvironmentRedeployDecision } from "./managed-environment-redeploy";

describe("managed environment redeploy reconciliation", () => {
  it("materializes when runtime artifacts are missing", () => {
    expect(managedEnvironmentRedeployDecision({
      hasProfile: true,
      runtimeReady: false,
      desiredHash: "desired",
      materializedHash: "desired",
    })).toMatchObject({
      action: "materialize-missing",
      shouldMaterialize: true,
    });
  });

  it("materializes when saved values differ from the deployed revision", () => {
    expect(managedEnvironmentRedeployDecision({
      hasProfile: true,
      runtimeReady: true,
      desiredHash: "new-revision",
      materializedHash: "old-revision",
    })).toMatchObject({
      action: "materialize-changed",
      shouldMaterialize: true,
    });
  });

  it("reuses a complete bundle only when its hash matches desired state", () => {
    expect(managedEnvironmentRedeployDecision({
      hasProfile: true,
      runtimeReady: true,
      desiredHash: "current",
      materializedHash: "current",
    })).toMatchObject({
      action: "reuse-current",
      shouldMaterialize: false,
    });
  });

  it("uses Compose defaults when no managed environment exists", () => {
    expect(managedEnvironmentRedeployDecision({
      hasProfile: false,
      runtimeReady: false,
    })).toMatchObject({
      action: "none",
      shouldMaterialize: false,
    });
  });
});
