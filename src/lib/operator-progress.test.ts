import { describe, expect, it } from "vitest";
import {
  deploymentRunProgress,
  narrativeRequestsAction,
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
});
