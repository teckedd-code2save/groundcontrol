import type {
  ActionPlan,
  EvidenceArtifact,
  Hypothesis,
  Investigation,
  JourneyRunResult,
  LastKnownHealthy,
  OperationalEvent,
  ServiceGraph,
} from "./types";
import { listServicePaths } from "./service-graph";
import {
  createRestoreProxyPlan,
  createRestartStatelessPlan,
  createRedeployArtifactPlan,
} from "./recovery";

/**
 * Deterministic investigation for MVP fixtures and offline use.
 * Produces structured evidence, hypotheses, uncertainty, and a recommended action.
 * Never executes host commands.
 */
export function investigateDeterministic(args: {
  graph: ServiceGraph;
  events: OperationalEvent[];
  journeyResults: JourneyRunResult[];
  lastHealthy?: LastKnownHealthy | null;
  proxyRevisionId?: string;
  previousArtifactRef?: string;
  domain?: string;
}): Investigation {
  const evidence: EvidenceArtifact[] = [];
  const at = new Date().toISOString();
  const paths = args.domain
    ? listServicePaths(args.graph).filter(
        (p) => p.domain.toLowerCase() === args.domain!.toLowerCase()
      )
    : listServicePaths(args.graph);
  const degraded = paths.filter((p) => !p.healthy);
  const failedJourneys = args.journeyResults.filter((j) => !j.ok);

  for (const p of paths) {
    evidence.push({
      id: `evd_path_${p.domain}`,
      kind: "service_path",
      summary: `${p.domain} → ${p.upstream || "?"} (${p.containerName || "no container"}) healthy=${p.healthy}`,
      detail: JSON.stringify({ issues: p.issues, state: p.containerState }),
      observedAt: at,
      serviceIds: p.serviceId ? [p.serviceId] : [],
    });
  }

  for (const ev of args.events) {
    evidence.push({
      id: `evd_event_${ev.id}`,
      kind: "operational_event",
      summary: `${ev.kind} services=${ev.serviceIds.join(",")}`,
      detail: JSON.stringify({
        beforeRef: ev.beforeRef,
        afterRef: ev.afterRef,
        meta: ev.meta,
      }),
      observedAt: ev.observedAt,
      serviceIds: ev.serviceIds,
    });
  }

  for (const jr of args.journeyResults) {
    evidence.push({
      id: `evd_journey_${jr.journeyId}`,
      kind: "journey_result",
      summary: `Journey ${jr.journeyId} ${jr.ok ? "passed" : "failed"}`,
      detail: JSON.stringify(jr.stepResults),
      observedAt: jr.observedAt,
    });
  }

  if (args.lastHealthy) {
    evidence.push({
      id: `evd_last_healthy_${args.lastHealthy.serviceId}`,
      kind: "last_known_healthy",
      summary: `Last healthy upstream ${args.lastHealthy.graphPath.upstream} at ${args.lastHealthy.capturedAt}`,
      detail: JSON.stringify(args.lastHealthy.snapshot),
      observedAt: args.lastHealthy.capturedAt,
      serviceIds: [args.lastHealthy.serviceId],
    });
  }

  const hypotheses: Hypothesis[] = [];
  let confirmedCause: string | undefined;
  let confirmedConcept: string | undefined;
  const uncertainty: string[] = [];

  const wrongPortPath = degraded.find((p) => p.issues.includes("wrong_upstream_port"));
  if (wrongPortPath) {
    const hypId = "hyp_wrong_upstream_port";
    const supporting = [
      `evd_path_${wrongPortPath.domain}`,
      ...args.events.filter((e) => e.kind === "proxy_changed").map((e) => `evd_event_${e.id}`),
    ];
    if (args.lastHealthy) supporting.push(`evd_last_healthy_${args.lastHealthy.serviceId}`);
    for (const jr of failedJourneys) supporting.push(`evd_journey_${jr.journeyId}`);

    hypotheses.push({
      id: hypId,
      statement: `Reverse proxy upstream for ${wrongPortPath.domain} targets ${wrongPortPath.upstream}, which does not match the container listen ports.`,
      supportingEvidenceIds: supporting,
      contradictingEvidenceIds: [],
      confidence: 0.92,
      status: "confirmed",
      concept: "wrong_upstream_port",
    });
    confirmedCause = hypotheses[0].statement;
    confirmedConcept = "wrong_upstream_port";
  }

  const downPath = degraded.find(
    (p) =>
      p.issues.some((i) => i.startsWith("container_") && i !== "container_running") ||
      (p.containerState && p.containerState.toLowerCase() !== "running")
  );
  if (downPath && !confirmedConcept) {
    hypotheses.push({
      id: "hyp_container_down",
      statement: `Container ${downPath.containerName || "unknown"} for ${downPath.domain} is not running (state=${downPath.containerState}).`,
      supportingEvidenceIds: [
        `evd_path_${downPath.domain}`,
        ...failedJourneys.map((j) => `evd_journey_${j.journeyId}`),
      ],
      contradictingEvidenceIds: [],
      confidence: 0.88,
      status: "confirmed",
      concept: "container_not_running",
    });
    confirmedCause = hypotheses[hypotheses.length - 1].statement;
    confirmedConcept = "container_not_running";
  }

  const noMatch = degraded.find((p) => p.issues.includes("no_container_match"));
  if (noMatch && !confirmedConcept) {
    hypotheses.push({
      id: "hyp_no_upstream",
      statement: `No container matches proxy upstream for ${noMatch.domain} (${noMatch.upstream}).`,
      supportingEvidenceIds: [`evd_path_${noMatch.domain}`],
      contradictingEvidenceIds: [],
      confidence: 0.8,
      status: "confirmed",
      concept: "no_container_match",
    });
    confirmedCause = hypotheses[hypotheses.length - 1].statement;
    confirmedConcept = "no_container_match";
  }

  if (failedJourneys.length > 0 && !confirmedConcept) {
    hypotheses.push({
      id: "hyp_external_failure",
      statement: "Customer journey failed but graph path issues are ambiguous.",
      supportingEvidenceIds: failedJourneys.map((j) => `evd_journey_${j.journeyId}`),
      contradictingEvidenceIds: paths.filter((p) => p.healthy).map((p) => `evd_path_${p.domain}`),
      confidence: 0.4,
      status: "open",
      concept: "ambiguous_external_failure",
    });
    uncertainty.push("Journey failed without a clear graph mismatch; external dependency possible.");
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      id: "hyp_healthy",
      statement: "No degraded service path detected from current evidence.",
      supportingEvidenceIds: paths.filter((p) => p.healthy).map((p) => `evd_path_${p.domain}`),
      contradictingEvidenceIds: [],
      confidence: 0.7,
      status: "open",
      concept: "no_fault_detected",
    });
    uncertainty.push("Insufficient failure signal for a confirmed cause.");
  }

  // Rejected alternatives when we have a strong concept
  if (confirmedConcept === "wrong_upstream_port") {
    hypotheses.push({
      id: "hyp_reject_dns",
      statement: "DNS or TLS certificate failure is the primary cause.",
      supportingEvidenceIds: [],
      contradictingEvidenceIds: evidence
        .filter((e) => e.kind === "service_path")
        .map((e) => e.id),
      confidence: 0.15,
      status: "rejected",
      concept: "dns_tls_failure",
    });
  }

  let recommendedAction: ActionPlan | undefined;
  const primaryPath = wrongPortPath || downPath || degraded[0] || paths[0];

  if (confirmedConcept === "wrong_upstream_port" && args.proxyRevisionId) {
    recommendedAction = createRestoreProxyPlan({
      proxyRevisionId: args.proxyRevisionId,
      domain: primaryPath?.domain,
      hostId: args.graph.hostId,
      evidenceIds: evidence.map((e) => e.id).slice(0, 6),
      journeyIds: failedJourneys.map((j) => j.journeyId),
    });
  } else if (confirmedConcept === "container_not_running" && primaryPath?.containerName) {
    recommendedAction = createRestartStatelessPlan({
      containerName: primaryPath.containerName,
      serviceId: primaryPath.serviceId,
      hostId: args.graph.hostId,
      evidenceIds: evidence.map((e) => e.id).slice(0, 6),
      journeyIds: failedJourneys.map((j) => j.journeyId),
    });
  } else if (confirmedConcept === "container_not_running" && args.previousArtifactRef) {
    recommendedAction = createRedeployArtifactPlan({
      artifactRef: args.previousArtifactRef,
      serviceId: primaryPath?.serviceId,
      hostId: args.graph.hostId,
      evidenceIds: evidence.map((e) => e.id).slice(0, 6),
      journeyIds: failedJourneys.map((j) => j.journeyId),
    });
  }

  const symptom =
    failedJourneys.length > 0
      ? `Customer journey(s) failed: ${failedJourneys.map((j) => j.journeyId).join(", ")}`
      : degraded.length > 0
        ? `Degraded service path(s): ${degraded.map((p) => p.domain).join(", ")}`
        : "No active customer-facing failure detected";

  const customerImpact =
    failedJourneys.length > 0 || degraded.length > 0
      ? "Public application may return errors (e.g. 502/503) or be unreachable for end users."
      : "No confirmed customer impact from current evidence.";

  if (!recommendedAction && confirmedConcept) {
    uncertainty.push("Cause identified but no safe reversible action could be prepared from available revisions/artifacts.");
  }

  return {
    symptom,
    customerImpact,
    hypotheses,
    confirmedCause,
    confirmedConcept,
    uncertainty,
    recommendedAction,
    evidence,
    provider: "deterministic",
  };
}

/**
 * Evaluate whether an investigation satisfies fixture claims.
 */
export function evaluateInvestigationFixture(args: {
  investigation: Investigation;
  requiredConcepts: string[];
  forbiddenConcepts?: string[];
  requireUncertainty?: boolean;
  requireEvidence?: boolean;
}): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const concepts = new Set(
    args.investigation.hypotheses
      .filter((h) => h.status === "confirmed" || h.status === "open")
      .map((h) => h.concept)
      .filter(Boolean) as string[]
  );
  if (args.investigation.confirmedConcept) {
    concepts.add(args.investigation.confirmedConcept);
  }

  for (const req of args.requiredConcepts) {
    if (!concepts.has(req) && args.investigation.confirmedConcept !== req) {
      // also accept statement containing concept key
      const inStatement = args.investigation.hypotheses.some(
        (h) => h.status === "confirmed" && (h.concept === req || h.statement.toLowerCase().includes(req.replace(/_/g, " ")))
      );
      if (!inStatement) reasons.push(`missing_required_concept:${req}`);
    }
  }

  for (const bad of args.forbiddenConcepts || []) {
    if (args.investigation.confirmedConcept === bad) {
      reasons.push(`forbidden_concept_confirmed:${bad}`);
    }
  }

  if (args.requireEvidence !== false) {
    const withEvidence = args.investigation.hypotheses.filter(
      (h) => h.status === "confirmed" && h.supportingEvidenceIds.length > 0
    );
    if (withEvidence.length === 0 && args.requiredConcepts.length > 0) {
      reasons.push("confirmed_hypothesis_lacks_evidence");
    }
  }

  if (args.requireUncertainty && args.investigation.uncertainty.length === 0) {
    // uncertainty optional when confidence high — only require when flagged
    if ((args.investigation.hypotheses.find((h) => h.status === "confirmed")?.confidence || 0) < 0.85) {
      reasons.push("missing_uncertainty");
    }
  }

  // Every confirmed hypothesis must list evidence ids
  for (const h of args.investigation.hypotheses) {
    if (h.status === "confirmed" && h.supportingEvidenceIds.length === 0) {
      reasons.push(`hypothesis_without_evidence:${h.id}`);
    }
  }

  return { pass: reasons.length === 0, reasons };
}

