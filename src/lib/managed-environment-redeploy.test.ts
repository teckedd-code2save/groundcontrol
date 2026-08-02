import { describe, expect, it } from "vitest";
import {
  expectedManagedEnvironmentArtifacts,
  managedEnvironmentRedeployDecision,
} from "./managed-environment-redeploy";

describe("managed environment redeploy reconciliation", () => {
  it("materializes when runtime artifacts are missing", () => {
    expect(managedEnvironmentRedeployDecision({
      hasProfile: true,
      runtimeReady: false,
      bundleMatchesDesired: false,
      desiredHash: "desired",
      materializedHash: "desired",
    })).toMatchObject({
      action: "materialize-missing",
      shouldMaterialize: true,
    });
  });

  it("materializes when artifact checksums differ from desired state", () => {
    expect(managedEnvironmentRedeployDecision({
      hasProfile: true,
      runtimeReady: true,
      bundleMatchesDesired: false,
      desiredHash: "new-revision",
      materializedHash: "old-revision",
    })).toMatchObject({
      action: "materialize-changed",
      shouldMaterialize: true,
    });
  });

  it("reuses a complete bundle only when its checksums match desired state", () => {
    expect(managedEnvironmentRedeployDecision({
      hasProfile: true,
      runtimeReady: true,
      bundleMatchesDesired: true,
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
      bundleMatchesDesired: false,
    })).toMatchObject({
      action: "none",
      shouldMaterialize: false,
    });
  });

  it("builds deterministic deployment, component, manifest and override artifacts", () => {
    const artifacts = expectedManagedEnvironmentArtifacts({
      deployPath: "/opt/example",
      environmentSlug: "production",
      values: { DOMAIN: "example.com" },
      componentValues: {
        web: { API_UPSTREAM: "http://api:3000" },
        api: { PORT: "3000" },
      },
    });

    expect(artifacts.map((artifact) => artifact.scope)).toEqual([
      "deployment environment",
      "api environment",
      "web environment",
      "runtime manifest",
      "Compose environment overlay",
    ]);
    expect(artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.hash))).toBe(true);
  });
});
