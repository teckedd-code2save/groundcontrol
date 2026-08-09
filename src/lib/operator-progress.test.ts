import { describe, expect, it } from "vitest";
import {
  deploymentRunProgress,
  incidentRecoveryOutcome,
  narrativeRequestsAction,
  operatorNarrativeIsComplete,
  parseOperatorNarrative,
} from "./operator-progress";

describe("operator progress", () => {
  it("turns model markdown into structured operator sections", () => {
    const sections = parseOperatorNarrative("### Problem\nThe **API** is down.\n\n### Fix\n- Start `api`\n- Verify health");
    expect(sections).toEqual([
      { title: "Problem", paragraphs: ["The API is down."], bullets: [] },
      { title: "Fix", paragraphs: [], bullets: ["Start api", "Verify health"] },
    ]);
  });

  it("detects prose-only approval requests", () => {
    expect(narrativeRequestsAction("Please confirm if you would like me to proceed with this action.")).toBe(true);
    expect(narrativeRequestsAction("The service is stopped. No safe action is available.")).toBe(false);
  });

  it("only treats a structured Problem, Fix, Verify result as complete", () => {
    expect(operatorNarrativeIsComplete("### Problem\nDown\n### Fix\nRestart\n### Verify\nProbe")).toBe(true);
    expect(operatorNarrativeIsComplete("Assessment\nA tool was refused.")).toBe(false);
    expect(operatorNarrativeIsComplete("Please confirm.Problem\nFailed\nFix\nNone\nVerify\nNot run")).toBe(false);
  });

  it("surfaces one honest recovery outcome from the strongest completed evidence", () => {
    expect(incidentRecoveryOutcome([{
      name: "verify_public_endpoint",
      status: "success",
      output: "HTTP 200 · endpoint healthy",
    }], "", null)?.kind).toBe("verified");
    expect(incidentRecoveryOutcome([{
      name: "prepare_source_fix_in_daytona",
      status: "success",
      output: "Validation passed",
    }], "", null)?.kind).toBe("source-repair");
    expect(incidentRecoveryOutcome([], "", "compose_up")?.kind).toBe("action-ready");
  });

  it("attributes a failed run to its real stage and removes meaningless percentages", () => {
    const progress = deploymentRunProgress("failed", [
      "[validate] Effective Compose configuration OK (/opt/app/compose.yml)",
      "[pull]",
      "[deploy] Starting Docker Compose recreation",
      "[deploy] Docker Compose failed to recreate the deployment (exit 1)",
    ], "Docker Compose failed with exit code 1.");
    expect(progress.failedStage).toBe("recreate");
    expect(progress.percent).toBeNull();
    expect(progress.stages.find((stage) => stage.id === "verify")?.status).toBe("not-reached");
  });

  it("shows an evidence-driven active deployment stage", () => {
    const progress = deploymentRunProgress("deploying", [
      "[validate] Effective Compose configuration OK (/opt/app/compose.yml)",
      "[pull]",
      "[deploy] Starting Docker Compose recreation",
    ]);
    expect(progress.activeStage).toBe("recreate");
    expect(progress.percent).toBe(60);
  });

  it("does not invent an environment phase before evidence arrives", () => {
    const progress = deploymentRunProgress("deploying", [
      "[prepare] Deployment request accepted",
    ]);
    expect(progress.activeStage).toBeNull();
    expect(progress.summary).toBe("Starting deployment");
    expect(progress.stages.every((stage) => stage.status === "pending")).toBe(true);
  });

  it("distinguishes registry and image work from configuration loading", () => {
    const progress = deploymentRunProgress("deploying", [
      "[configuration] Deployment configuration ready",
      "[compose] Effective Compose configuration valid (/opt/app/compose.yml)",
      "[registry] Authenticating configured container registry",
    ]);
    expect(progress.activeStage).toBe("pull");
    expect(progress.summary).toBe("Authenticate and pull in progress");
  });

  it("shows exact recorded failure evidence ahead of a generic client error", () => {
    const progress = deploymentRunProgress("failed", [
      "[failure] phase=pull error=denied: repository access is unavailable",
    ], "Redeploy failed");
    expect(progress.failedStage).toBe("pull");
    expect(progress.evidence).toBe("[failure] phase=pull error=denied: repository access is unavailable");
  });

  it("prefers recorded Compose diagnostics over a generic persisted error", () => {
    const progress = deploymentRunProgress("failed", [
      "[deploy] Docker Compose failed to recreate the deployment (exit 1)",
      "[container-log] container=api Error: DATABASE_URL is missing",
    ], "Docker Compose failed with exit code 1.");

    expect(progress.evidence).toBe("[container-log] container=api Error: DATABASE_URL is missing");
    expect(progress.stages[0].detail).toMatch(/live project/i);
  });

  it("attributes an explicitly recorded Compose phase failure without guessing", () => {
    const progress = deploymentRunProgress("failed", [
      "[configuration] Deployment configuration ready",
      "[compose] Validating the effective Compose configuration",
      "[failure] phase=compose error=service api has neither an image nor a build context",
    ]);
    expect(progress.failedStage).toBe("compose");
    expect(progress.stages.find((stage) => stage.id === "environment")?.status).toBe("complete");
  });

  it("cannot fail a stage that its own evidence marks complete", () => {
    const progress = deploymentRunProgress("failed", [
      "[configuration] Deployment configuration ready",
      "[compose] Effective Compose configuration valid (/opt/app/compose.yml)",
      "[pull] Images resolved",
    ], "Effective Compose configuration is invalid");

    expect(progress.failedStage).toBe("recreate");
    expect(progress.summary).toBe("Recreate runtime failed");
    expect(progress.stages.find((stage) => stage.id === "compose")?.status).toBe("complete");
    expect(progress.evidence).toBe("Effective Compose configuration is invalid");
  });

  it("does not turn the last successful phase into failure evidence", () => {
    const progress = deploymentRunProgress("failed", [
      "[configuration] Deployment configuration ready",
      "[compose] Effective Compose configuration valid (/opt/app/compose.yml)",
      "[pull] Images resolved",
    ]);

    expect(progress.evidence).toMatch(/terminal failure evidence was not recorded/i);
    expect(progress.evidence).not.toContain("[pull] Images resolved");
  });

  it("keeps concrete evidence on the failed verification stage", () => {
    const progress = deploymentRunProgress("failed", [
      "[configuration] Deployment configuration ready",
      "[compose] Effective Compose configuration valid (/opt/agent-flow/RentAWeekend/docker-compose.yml)",
      "[pull] Images resolved",
      "[deploy] Docker Compose recreation completed",
      "[verify] Runtime image verification failed (exit 42)",
      "[failure] phase=verify error=web image does not match resolved compose image",
    ]);
    const verify = progress.stages.find((stage) => stage.id === "verify");

    expect(progress.failedStage).toBe("verify");
    expect(verify?.status).toBe("failed");
    expect(verify?.evidenceLines).toEqual([
      "[verify] Runtime image verification failed (exit 42)",
      "[failure] phase=verify error=web image does not match resolved compose image",
    ]);
  });
});
