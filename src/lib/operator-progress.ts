export type OperatorNarrativeSection = {
  title: string;
  paragraphs: string[];
  bullets: string[];
};

export type DeploymentStageId = "environment" | "compose" | "pull" | "recreate" | "verify";
export type DeploymentStageStatus = "complete" | "running" | "failed" | "pending" | "not-reached";

export type DeploymentStage = {
  id: DeploymentStageId;
  label: string;
  status: DeploymentStageStatus;
};

export type DeploymentRunProgress = {
  stages: DeploymentStage[];
  activeStage: DeploymentStageId | null;
  failedStage: DeploymentStageId | null;
  percent: number | null;
  summary: string;
  evidence: string | null;
};

const STAGE_LABELS: Record<DeploymentStageId, string> = {
  environment: "Load configuration",
  compose: "Validate Compose",
  pull: "Authenticate and pull",
  recreate: "Recreate runtime",
  verify: "Verify runtime images",
};

export function stripOperatorMarkdown(value: string): string {
  return value
    .replace(/^\s*#{1,6}\s*/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();
}

export function parseOperatorNarrative(value: string): OperatorNarrativeSection[] {
  const sections: OperatorNarrativeSection[] = [];
  let current: OperatorNarrativeSection = { title: "Assessment", paragraphs: [], bullets: [] };
  const flush = () => {
    if (current.paragraphs.length || current.bullets.length) sections.push(current);
  };

  for (const rawLine of value.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flush();
      current = { title: stripOperatorMarkdown(heading[1]), paragraphs: [], bullets: [] };
      continue;
    }
    const numberedHeading = line.match(/^\d+\.\s+\*\*([^*]+)\*\*:?\s*$/);
    if (numberedHeading) {
      flush();
      current = { title: stripOperatorMarkdown(numberedHeading[1]), paragraphs: [], bullets: [] };
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      current.bullets.push(stripOperatorMarkdown(bullet[1]));
      continue;
    }
    current.paragraphs.push(stripOperatorMarkdown(line.replace(/^\d+\.\s+/, "")));
  }
  flush();
  return sections;
}

export function narrativeRequestsAction(value: string): boolean {
  return /\b(please\s+confirm|confirm\s+(?:if|to)|would\s+you\s+like\s+to\s+proceed|i\s+will\s+(?:proceed|start|restart|apply|create)|approve\s+(?:this|the)\s+action)\b/i.test(value);
}

export function deploymentRunProgress(
  status: "deploying" | "success" | "failed",
  lines: string[],
  failure?: string | null
): DeploymentRunProgress {
  const evidenceLines = [...lines, failure || ""].map((line) => line.trim()).filter(Boolean);
  const includes = (pattern: RegExp) => evidenceLines.some((line) => pattern.test(line));
  const environmentStarted = includes(/\[(configuration|env)\]/i);
  const environmentComplete = includes(/\[configuration\]\s+deployment configuration ready/i)
    || includes(/\[env\].*materialized|environment materialized/i)
    || includes(/\[validate\]\s+effective compose configuration ok/i);
  const composeStarted = includes(/\[(compose|validate)\]/i);
  const composeComplete = includes(/\[compose\]\s+effective compose configuration valid/i)
    || includes(/\[validate\]\s+effective compose configuration ok/i);
  const pullStarted = includes(/\[(registry|pull)\]/i);
  const pullComplete = includes(/\[pull\]\s+(images resolved|image pull completed)/i)
    || includes(/^\[pull\]\s*$/i);
  const recreateStarted = includes(/\[deploy\]\s+starting/i);
  const recreateComplete = includes(/\[deploy\]\s+docker compose recreation completed/i);
  const verifyStarted = includes(/\[verify\]\s+checking/i);
  const verifyComplete = status === "success" || includes(/\[verify\]\s+running images match/i);

  const completed: Record<DeploymentStageId, boolean> = {
    environment: environmentComplete,
    compose: composeComplete,
    pull: pullComplete,
    recreate: recreateComplete,
    verify: verifyComplete,
  };
  const order: DeploymentStageId[] = ["environment", "compose", "pull", "recreate", "verify"];
  let activeStage: DeploymentStageId | null = null;
  if (status === "deploying") {
    activeStage = verifyStarted ? "verify"
      : recreateStarted ? "recreate"
        : pullStarted && !pullComplete ? "pull"
          : composeStarted && !composeComplete ? "compose"
            : environmentStarted && !environmentComplete ? "environment"
              : null;
  }

  let failedStage: DeploymentStageId | null = null;
  if (status === "failed") {
    failedStage = includes(/\[failure\]\s+phase=(verify)\b|runtime image verification failed|running image does not match/i) ? "verify"
      : includes(/\[failure\]\s+phase=(recreate|deploy)\b|docker compose failed|compose.*exit|recreate/i) ? "recreate"
        : includes(/\[failure\]\s+phase=(registry|pull)\b|image pull failed|pull access denied|manifest unknown/i) ? "pull"
          : includes(/\[failure\]\s+phase=compose\b|compose configuration|compose config|yaml|validation/i) ? "compose"
            : "environment";
  }

  const stages = order.map((id, index): DeploymentStage => {
    if (completed[id]) return { id, label: STAGE_LABELS[id], status: "complete" };
    if (id === failedStage) return { id, label: STAGE_LABELS[id], status: "failed" };
    if (id === activeStage) return { id, label: STAGE_LABELS[id], status: "running" };
    const terminalIndex = failedStage ? order.indexOf(failedStage) : -1;
    return {
      id,
      label: STAGE_LABELS[id],
      status: status === "failed" && index > terminalIndex ? "not-reached" : "pending",
    };
  });
  const completedCount = stages.filter((stage) => stage.status === "complete").length;
  const evidence = [...evidenceLines].reverse().find((line) => /^\[failure\]\s+/i.test(line))
    || [...evidenceLines].reverse().find((line) => !/^__GC_REDEPLOY_STATUS__/.test(line))
    || null;

  return {
    stages,
    activeStage,
    failedStage,
    percent: status === "failed" ? null : status === "success" ? 100 : Math.round((completedCount / order.length) * 100),
    summary: status === "failed"
      ? `${STAGE_LABELS[failedStage || "environment"]} failed`
      : status === "success"
        ? "Deployment verified"
        : activeStage
          ? `${STAGE_LABELS[activeStage]} in progress`
          : "Starting deployment",
    evidence,
  };
}
