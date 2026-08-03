import { describe, expect, it } from "vitest";
import {
  buildManagedEnvironmentRecoveryCommand,
  diagnoseManagedEnvironmentFailure,
  expectedManagedEnvironmentArtifacts,
  inspectManagedEnvironmentArtifactOutput,
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

  it("treats one missing component file as an incomplete runtime bundle", () => {
    const artifacts = expectedManagedEnvironmentArtifacts({
      deployPath: "/opt/example",
      environmentSlug: "production",
      values: { DOMAIN: "example.com" },
      componentValues: {
        api: { PORT: "3000" },
        web: { API_UPSTREAM: "http://api:3000" },
      },
    });
    const inspection = inspectManagedEnvironmentArtifactOutput(
      "missing|api environment\n",
      true,
      artifacts
    );

    expect(inspection).toMatchObject({
      missingArtifacts: ["api environment"],
      changedArtifacts: [],
      runtimeReady: false,
      bundleMatchesDesired: false,
    });
  });

  it("distinguishes stale artifacts from missing artifacts", () => {
    const artifacts = expectedManagedEnvironmentArtifacts({
      deployPath: "/opt/example",
      environmentSlug: "production",
      values: {},
      componentValues: { api: { PORT: "3000" } },
    });
    const inspection = inspectManagedEnvironmentArtifactOutput(
      "changed|api environment\nchanged|Compose environment overlay\n",
      true,
      artifacts
    );

    expect(inspection).toMatchObject({
      missingArtifacts: [],
      changedArtifacts: ["api environment", "Compose environment overlay"],
      runtimeReady: true,
      bundleMatchesDesired: false,
    });
  });

  it("fails closed when artifact inspection itself fails", () => {
    const artifacts = expectedManagedEnvironmentArtifacts({
      deployPath: "/opt/example",
      environmentSlug: "production",
      values: {},
      componentValues: { api: { PORT: "3000" } },
    });
    const inspection = inspectManagedEnvironmentArtifactOutput("", false, artifacts);

    expect(inspection.runtimeReady).toBe(false);
    expect(inspection.bundleMatchesDesired).toBe(false);
    expect(inspection.missingArtifacts).toEqual(artifacts.map((artifact) => artifact.scope));
  });

  it("retries directory and permission failures but not storage failures", () => {
    expect(diagnoseManagedEnvironmentFailure(new Error("ENOENT: no such file or directory"))).toMatchObject({
      code: "ENV_RUNTIME_DIRECTORY",
      automaticallyRecoverable: true,
    });
    expect(diagnoseManagedEnvironmentFailure(new Error("permission denied"))).toMatchObject({
      code: "ENV_PERMISSION_DENIED",
      automaticallyRecoverable: true,
    });
    expect(diagnoseManagedEnvironmentFailure(new Error("no space left on device"))).toMatchObject({
      code: "ENV_STORAGE_FULL",
      automaticallyRecoverable: false,
    });
  });

  it("does not auto-retry decryption or read-only filesystem failures", () => {
    expect(diagnoseManagedEnvironmentFailure(new Error("Unsupported state or unable to authenticate data"))).toMatchObject({
      code: "ENV_DECRYPTION_FAILED",
      automaticallyRecoverable: false,
    });
    expect(diagnoseManagedEnvironmentFailure(new Error("Read-only file system"))).toMatchObject({
      code: "ENV_READ_ONLY_FILESYSTEM",
      automaticallyRecoverable: false,
    });
  });

  it("repairs only GroundControl-owned runtime artifacts", () => {
    const command = buildManagedEnvironmentRecoveryCommand("/opt/example", "production");

    expect(command).toContain("/run/groundcontrol/environments/");
    expect(command).toContain("-name '*.new' -delete");
    expect(command).toContain(".groundcontrol-write-probe");
    expect(command).not.toContain("docker volume rm");
    expect(command).not.toContain("docker system prune");
  });
});
