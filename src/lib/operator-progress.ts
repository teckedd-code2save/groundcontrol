export type OperatorNarrativeSection = {
  title: string;
  paragraphs: string[];
  bullets: string[];
};

export type DeploymentStageId = "environment" | "compose" | "pull" | "recreate" | "verify" | "public";
export type DeploymentStageStatus = "complete" | "running" | "failed" | "pending" | "not-reached";

export type DeploymentStage = {
  id: DeploymentStageId;
  label: string;
  detail: string;
  status: DeploymentStageStatus;
  evidenceLines?: string[];
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
  verify: "Verify service runtime",
  public: "Verify release checks",
};

const STAGE_DETAILS: Record<DeploymentStageId, string> = {
  environment: "Resolve the live project and reuse its synchronized configuration.",
  compose: "Render and validate the exact Compose model that will be executed.",
  pull: "Authenticate the configured registry and resolve the requested images.",
  recreate: "Recreate the declared services, dependencies, networks, and one-shot jobs.",
  verify: "For each Compose service, compare the resolved image with the observed container. Running services must be running; completed one-shot jobs must exit 0.",
  public: "Run configured public and feature checks from the deployment host, then fail the run before users find a broken route.",
};

const STAGE_EVIDENCE_PATTERNS: Record<DeploymentStageId, RegExp[]> = {
  environment: [/\[(prepare|target|configuration|env)\]/i],
  compose: [/\[(compose|validate)\]/i, /\bcompose\b.*\b(valid|config|yaml|services)\b/i],
  pull: [/\[(registry|pull|image)\]/i, /\b(access denied|manifest unknown|pull)\b/i],
  recreate: [/\[(deploy|runtime|container)\]/i, /\b(recreate|created|started|exited|unhealthy)\b/i],
  verify: [/\[(verify|health|probe)\]/i, /\b(runtime image|public result|health|http|does not match)\b/i],
  public: [/\[(public|check)\]/i, /\[failure\]\s+phase=public\b/i],
};

const STAGE_FAILURE_PHASES: Record<DeploymentStageId, string[]> = {
  environment: ["environment", "configuration", "env", "prepare", "target"],
  compose: ["compose", "validate", "validation"],
  pull: ["pull", "registry", "image"],
  recreate: ["recreate", "deploy", "runtime"],
  verify: ["verify", "health", "probe"],
  public: ["public", "route", "endpoint"],
};

function stageEvidence(id: DeploymentStageId, lines: string[], failure?: string | null) {
  const all = [...lines, failure || ""].map((line) => line.trim()).filter(Boolean);
  const patterns = STAGE_EVIDENCE_PATTERNS[id];
  const matched = all.filter((line) => {
    const phase = line.match(/^\[failure\]\s+phase=([a-z_-]+)/i)?.[1]?.toLowerCase();
    if (phase) return STAGE_FAILURE_PHASES[id].includes(phase);
    return patterns.some((pattern) => pattern.test(line));
  });
  return [...new Set(matched)].slice(-12);
}

function inferLegacyVerifyFailure(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    const blankRunning = line.match(/^\[verify\]\s+([A-Za-z0-9_.-]+):\s+running\s*$/i);
    if (!blankRunning) continue;
    const service = blankRunning[1];
    const servicePattern = service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expected = [...lines.slice(0, index)].reverse().find((candidate) =>
      new RegExp(`^\\[verify\\]\\s+${servicePattern}:\\s+expected\\s+`, "i").test(candidate.trim())
    );
    return expected
      ? `[failure] phase=verify service=${service} error=no running image was observed after Compose recreation; ${expected.replace(/^\[verify\]\s+/i, "")}`
      : `[failure] phase=verify service=${service} error=no running image was observed after Compose recreation`;
  }
  return null;
}

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
      detail: "Daytona reproduced the failure at the deployed revision, proved the candidate, passed the independent regression matrix and cleaned up the sandbox. The reviewed diff is ready for source-control approval.",
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
  const verifyComplete = status === "success" || includes(/\[verify\]\s+(running images|service images).*match/i);
  const publicStarted = includes(/\[(public|check)\]\s+.*checking|\[check\]\s+running/i);
  const publicComplete = status === "success" || includes(/\[public\]\s+public endpoint verified|\[check\]\s+release verification passed|no (public endpoint|release verification checks) configured; skipped/i);

  const completed: Record<DeploymentStageId, boolean> = {
    environment: environmentComplete,
    compose: composeComplete,
    pull: pullComplete,
    recreate: recreateComplete,
    verify: verifyComplete,
    public: publicComplete,
  };
  const order: DeploymentStageId[] = ["environment", "compose", "pull", "recreate", "verify", "public"];
  let activeStage: DeploymentStageId | null = null;
  if (status === "deploying") {
    activeStage = publicStarted ? "public"
      : verifyStarted ? "verify"
      : recreateStarted ? "recreate"
        : pullStarted && !pullComplete ? "pull"
          : composeStarted && !composeComplete ? "compose"
            : environmentStarted && !environmentComplete ? "environment"
              : null;
  }

  let failedStage: DeploymentStageId | null = null;
  if (status === "failed") {
    failedStage = includes(/\[failure\]\s+phase=public\b|public endpoint verification failed/i) ? "public"
      : includes(/\[failure\]\s+phase=(verify)\b|runtime image verification failed|runtime verification found|running image does not match/i) ? "verify"
        : includes(/\[failure\]\s+phase=(recreate|deploy)\b|docker compose failed|compose.*exit|recreate/i) ? "recreate"
          : includes(/\[failure\]\s+phase=(registry|pull)\b|image pull failed|pull access denied|manifest unknown/i) ? "pull"
            : includes(/\[failure\]\s+phase=compose\b|compose configuration|compose config|yaml|validation/i) ? "compose"
              : "environment";
  }
  if (failedStage && completed[failedStage]) {
    failedStage = order.find((id) => !completed[id]) || failedStage;
  }

  const stages = order.map((id, index): DeploymentStage => {
    const evidenceForStage = stageEvidence(id, lines, failure);
    if (completed[id]) return { id, label: STAGE_LABELS[id], detail: STAGE_DETAILS[id], status: "complete", evidenceLines: evidenceForStage };
    if (id === failedStage) return { id, label: STAGE_LABELS[id], detail: STAGE_DETAILS[id], status: "failed", evidenceLines: evidenceForStage };
    if (id === activeStage) return { id, label: STAGE_LABELS[id], detail: STAGE_DETAILS[id], status: "running", evidenceLines: evidenceForStage };
    const terminalIndex = failedStage ? order.indexOf(failedStage) : -1;
    return {
      id,
      label: STAGE_LABELS[id],
      detail: STAGE_DETAILS[id],
      status: status === "failed" && index > terminalIndex ? "not-reached" : "pending",
      evidenceLines: evidenceForStage,
    };
  });
  const completedCount = stages.filter((stage) => stage.status === "complete").length;
  const recordedFailure = [...lines].reverse().find((line) =>
    /^\[failure\]\s+/i.test(line.trim())
  );
  const legacyVerifyFailure = inferLegacyVerifyFailure(lines);
  const phaseFailure = [...lines].reverse().find((line) =>
    /^\[(deploy|verify)\].*\b(failed|unhealthy|does not match|mismatch)\b/i.test(line.trim())
  );
  const diagnosticFailure = [...lines].reverse().find((line) =>
    /\b(error|fatal|exception|failed|unhealthy|refused|denied|timeout)\b/i.test(line)
    && !/^\[(configuration|compose|registry|pull)\].*\b(ready|valid|resolved|completed)\b/i.test(line.trim())
  );
  const evidence = recordedFailure?.trim()
    || legacyVerifyFailure
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
