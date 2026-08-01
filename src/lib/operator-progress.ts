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
  detail: string;
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

export type IncidentRecoveryOutcome = {
  kind: "verified" | "source-repair" | "action-ready" | "decision-ready";
  title: string;
  detail: string;
};

const STAGE_LABELS: Record<DeploymentStageId, string> = {
  environment: "Load configuration",
  compose: "Validate Compose",
  pull: "Authenticate and pull",
  recreate: "Recreate runtime",
  verify: "Verify runtime images",
};

const STAGE_DETAILS: Record<DeploymentStageId, string> = {
  environment: "Resolve the live project and reuse its synchronized configuration.",
  compose: "Render and validate the exact Compose model that will be executed.",
  pull: "Authenticate the configured registry and resolve the requested images.",
  recreate: "Recreate the declared services, dependencies, networks, and one-shot jobs.",
  verify: "Compare running images with the resolved model and verify the public result.",
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

export function operatorNarrativeIsComplete(value: string): boolean {
  const titles = new Set(
    parseOperatorNarrative(value).map((section) => section.title.trim().toLowerCase())
  );
  return ["problem", "fix", "verify"].every((title) => titles.has(title));
}

export function incidentRecoveryOutcome(
  tools: Array<{ name: string; status: string; output?: string }>,
  content: string,
  confirmationName?: string | null
): IncidentRecoveryOutcome | null {
  const successfulVerification = [...tools].reverse().find((tool) =>
    tool.name === "verify_public_endpoint"
    && tool.status === "success"
    && /\b(http\s+2\d\d|status(?:code)?\s*[:=]?\s*2\d\d|passed|healthy|reachable)\b/i.test(tool.output || "")
    && !/\b(failed|unhealthy|unreachable|refused)\b/i.test(tool.output || "")
  );
  if (successfulVerification) {
    return {
      kind: "verified",
      title: "Customer endpoint verified",
      detail: "GroundControl completed the repair loop and confirmed the public result from outside the runtime.",
    };
  }
  const validatedSourceRepair = [...tools].reverse().find((tool) =>
    tool.name === "prepare_source_fix_in_daytona" && tool.status === "success"
  );
  if (validatedSourceRepair) {
    return {
      kind: "source-repair",
      title: "Source repair validated",
      detail: "The candidate fix reproduced and passed validation away from production. It is ready for the source-control approval step.",
    };
  }
  if (confirmationName) {
    return {
      kind: "action-ready",
      title: "Safe action ready",
      detail: "The exact target and reversible action are resolved. GroundControl will execute only after approval, then verify the public endpoint.",
    };
  }
  if (operatorNarrativeIsComplete(content)) {
    return {
      kind: "decision-ready",
      title: "Evidence-backed decision ready",
      detail: "The run reached a concrete Problem, Fix, Verify outcome without inventing a production mutation.",
    };
  }
  return null;
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
  if (failedStage && completed[failedStage]) {
    failedStage = order.find((id) => !completed[id]) || failedStage;
  }

  const stages = order.map((id, index): DeploymentStage => {
    if (completed[id]) return { id, label: STAGE_LABELS[id], detail: STAGE_DETAILS[id], status: "complete" };
    if (id === failedStage) return { id, label: STAGE_LABELS[id], detail: STAGE_DETAILS[id], status: "failed" };
    if (id === activeStage) return { id, label: STAGE_LABELS[id], detail: STAGE_DETAILS[id], status: "running" };
    const terminalIndex = failedStage ? order.indexOf(failedStage) : -1;
    return {
      id,
      label: STAGE_LABELS[id],
      detail: STAGE_DETAILS[id],
      status: status === "failed" && index > terminalIndex ? "not-reached" : "pending",
    };
  });
  const completedCount = stages.filter((stage) => stage.status === "complete").length;
  const recordedFailure = [...lines].reverse().find((line) =>
    /^\[failure\]\s+/i.test(line.trim())
  );
  const phaseFailure = [...lines].reverse().find((line) =>
    /^\[(deploy|verify)\].*\b(failed|unhealthy|does not match)\b/i.test(line.trim())
  );
  const diagnosticFailure = [...lines].reverse().find((line) =>
    /\b(error|fatal|exception|failed|unhealthy|refused|denied|timeout)\b/i.test(line)
    && !/^\[(configuration|compose|registry|pull)\].*\b(ready|valid|resolved|completed)\b/i.test(line.trim())
  );
  const evidence = recordedFailure?.trim()
    || diagnosticFailure?.trim()
    || phaseFailure?.trim()
    || failure?.trim()
    || (status === "failed" ? (() => {
      const lastCompleted = [...stages].reverse().find((stage) => stage.status === "complete");
      return lastCompleted
        ? `Deployment stopped after ${lastCompleted.label}; terminal failure evidence was not recorded.`
        : "Deployment stopped before any phase completed; terminal failure evidence was not recorded.";
    })() : null);

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
