/**
 * Loop orchestrator — pure(ish) control flow over graph, journeys, investigation, recovery.
 * Host I/O is injected via probe and recovery executors.
 */

import type {
  ChangeSet,
  CustomerJourney,
  LoopRun,
  OperationalEvent,
  ProxyRevision,
  ServiceGraph,
} from "./types";
import { reconcileServiceGraph, resolveServicePath, listServicePaths } from "./service-graph";
import { debounceEvents } from "./change-set";
import { computeAffectedServiceIds, selectJourneysForChange } from "./blast-radius";
import { runJourney } from "./journeys";
import { investigateDeterministic } from "./investigation";
import { investigateWithGemini } from "./providers/gemini";
import {
  captureLastKnownHealthy,
  LastHealthyStore,
} from "./last-healthy";
import type { ProbeExecutor } from "./probes";
import { runProbes } from "./probes";
import {
  canApplyMutation,
  executeActionPlan,
  fingerprintContent,
  type RecoveryExecutor,
} from "./recovery";
import {
  createLoopRun,
  markSideEffect,
  transitionRun,
} from "./state-machine";
import type { HostObservation } from "./types";
import { parseProxyRoutes } from "./proxy-parse";

export interface LoopEngineState {
  graph: ServiceGraph;
  events: OperationalEvent[];
  changeSets: ChangeSet[];
  journeys: CustomerJourney[];
  revisions: Map<string, ProxyRevision>;
  lastHealthy: LastHealthyStore;
  runs: Map<string, LoopRun>;
  /** Current proxy content after mutations (fixture/live mirror). */
  proxyContentByHost: Map<string, string>;
  /** Last ingested observation — used to re-reconcile graph after proxy recovery. */
  lastObservation?: HostObservation;
}

export function createEngineState(): LoopEngineState {
  return {
    graph: {
      hostId: "",
      nodes: [],
      edges: [],
      reconciledAt: new Date().toISOString(),
      source: "fixture",
    },
    events: [],
    changeSets: [],
    journeys: [],
    revisions: new Map(),
    lastHealthy: new LastHealthyStore(),
    runs: new Map(),
    proxyContentByHost: new Map(),
  };
}

/**
 * Apply a proxy revision into engine state: update content mirror and re-reconcile
 * the service graph from lastObservation + parsed routes so paths match reality.
 */
export function applyProxyRevisionToState(
  state: LoopEngineState,
  revision: ProxyRevision
): LoopEngineState {
  const proxyContentByHost = new Map(state.proxyContentByHost);
  proxyContentByHost.set(revision.hostId, revision.content);

  const base = state.lastObservation;
  if (!base) {
    return { ...state, proxyContentByHost };
  }

  const routes = parseProxyRoutes(revision.content, revision.proxyType);
  const observedAt = new Date().toISOString();
  const nextObs: HostObservation = {
    ...base,
    hostId: revision.hostId || base.hostId,
    observedAt,
    proxy: {
      type: revision.proxyType === "unknown" ? base.proxy?.type || "caddy" : revision.proxyType,
      configContent: revision.content,
      fingerprint: revision.fingerprint || fingerprintContent(revision.content),
      routes:
        routes.length > 0
          ? routes
          : base.proxy?.routes.map((r) => ({ ...r })) || [],
    },
  };

  const graph = reconcileServiceGraph(nextObs);
  return {
    ...state,
    lastObservation: nextObs,
    graph,
    proxyContentByHost,
  };
}

export function ingestObservation(
  state: LoopEngineState,
  obs: HostObservation
): LoopEngineState {
  const graph = reconcileServiceGraph(obs);
  const proxyContentByHost = new Map(state.proxyContentByHost);
  if (obs.proxy) proxyContentByHost.set(obs.hostId, obs.proxy.configContent);
  return { ...state, graph, proxyContentByHost, lastObservation: obs };
}

export function ingestEvents(
  state: LoopEngineState,
  events: OperationalEvent[],
  debounceMs = 15_000
): LoopEngineState {
  const merged = [...state.events, ...events];
  const changeSets = debounceEvents(merged, {
    debounceMs,
    now: new Date().toISOString(),
  });
  return { ...state, events: merged, changeSets };
}

export function registerJourney(
  state: LoopEngineState,
  journey: CustomerJourney
): LoopEngineState {
  const journeys = [
    ...state.journeys.filter((j) => j.id !== journey.id),
    journey,
  ];
  return { ...state, journeys };
}

export function registerRevision(
  state: LoopEngineState,
  rev: ProxyRevision
): LoopEngineState {
  const revisions = new Map(state.revisions);
  revisions.set(rev.id, rev);
  return { ...state, revisions };
}

/**
 * Full Loop path through investigation (read-only + journey execution).
 * Idempotent: re-invoking with the same run id will not re-run journeys/investigation.
 */
export async function advanceToInvestigation(args: {
  state: LoopEngineState;
  runId: string;
  changeSetId: string;
  probeExecutor: ProbeExecutor;
  domain?: string;
}): Promise<{ state: LoopEngineState; run: LoopRun }> {
  const { state, runId, changeSetId, probeExecutor } = args;
  const changeSet = state.changeSets.find((c) => c.id === changeSetId);
  if (!changeSet) throw new Error(`Change set not found: ${changeSetId}`);

  let run =
    state.runs.get(runId) ||
    createLoopRun({
      id: runId,
      hostId: changeSet.hostId,
      changeSetId,
      eventIds: changeSet.eventIds,
      serviceIds: changeSet.serviceIds,
      isFixture: state.graph.source === "fixture",
    });

  if (run.state === "observed") {
    run = transitionRun(run, "correlating", "correlating change set");
  }
  if (run.state === "correlating") {
    run = transitionRun(run, "stabilized", "change set stabilized");
  }

  const affected = computeAffectedServiceIds(changeSet, state.events, state.graph);
  run = { ...run, serviceIds: affected };

  const selected = selectJourneysForChange({
    journeys: state.journeys,
    changeSet,
    affectedServiceIds: affected,
  });

  if (run.state === "stabilized") {
    run = transitionRun(run, "exercising", `selected ${selected.length} journeys`);
  }

  if (run.state === "exercising" && !run.sideEffects.journeysRun) {
    const results = [];
    for (const j of selected) {
      results.push(await runJourney(j, probeExecutor));
    }
    run = {
      ...markSideEffect(run, "journeysRun"),
      journeyResults: results,
    };

    const allOk = results.length > 0 && results.every((r) => r.ok);
    if (allOk) {
      run = transitionRun(run, "verified_healthy", "all journeys passed");
      // capture last healthy
      for (const path of listServicePaths(state.graph)) {
        if (!path.healthy) continue;
        const probes = await runProbes(
          [
            {
              kind: "external",
              target: path.domain.startsWith("http")
                ? path.domain
                : `https://${path.domain}/`,
              serviceId: path.serviceId,
            },
          ],
          probeExecutor
        );
        const snap = captureLastKnownHealthy({
          hostId: state.graph.hostId,
          path,
          probes,
          capturedAt: new Date().toISOString(),
        });
        if (snap) state.lastHealthy.put(snap);
      }
      run = transitionRun(run, "remembered", "recorded healthy memory");
      run = markSideEffect(run, "memoryRecorded");
    } else {
      run = transitionRun(run, "investigating", "journey failure");
    }
  }

  if (run.state === "investigating" && !run.sideEffects.investigationDone) {
    const domain =
      args.domain ||
      listServicePaths(state.graph).find((p) => !p.healthy)?.domain ||
      listServicePaths(state.graph)[0]?.domain;

    const lastHealthy = domain
      ? state.lastHealthy.getForDomain(state.graph.hostId, domain) ||
        (run.serviceIds[0]
          ? state.lastHealthy.get(state.graph.hostId, run.serviceIds[0])
          : undefined)
      : undefined;

    // Prefer healthy proxy revision for restore
    const healthyRev = Array.from(state.revisions.values()).find(
      (r) => r.hostId === state.graph.hostId && r.label === "last-known-healthy"
    ) || Array.from(state.revisions.values()).find((r) => r.validated);

    const invArgs = {
      graph: state.graph,
      events: state.events.filter((e) => changeSet.eventIds.includes(e.id)),
      journeyResults: run.journeyResults,
      lastHealthy,
      proxyRevisionId: healthyRev?.id,
      domain,
    };
    // Prefer Gemini when configured; always falls back to deterministic (no shell).
    const investigation =
      process.env.GC_LOOP_DETERMINISTIC_ONLY === "1"
        ? investigateDeterministic(invArgs)
        : await investigateWithGemini(invArgs);

    run = {
      ...markSideEffect(run, "investigationDone"),
      investigation,
      actionPlan: investigation.recommendedAction,
    };

    if (investigation.recommendedAction?.approvalRequired) {
      run = transitionRun(run, "planning", "action plan prepared");
      run = transitionRun(run, "awaiting_approval", "waiting for operator approval");
    } else if (investigation.recommendedAction?.kind === "noop_guided") {
      run = transitionRun(run, "guided", "guided recovery");
    } else if (!investigation.recommendedAction) {
      run = transitionRun(run, "guided", "no safe action");
    } else {
      run = transitionRun(run, "planning", "planning");
      run = transitionRun(run, "awaiting_approval", "awaiting approval");
    }
  }

  const runs = new Map(state.runs);
  runs.set(run.id, run);
  return { state: { ...state, runs }, run };
}

/**
 * Approve and apply recovery, then verify. Failed verification triggers real rollback
 * via RecoveryExecutor (restoring pre-mutation proxy revision when available).
 * Restart-safe: will not re-apply or re-rollback if already done.
 */
export async function approveAndRecover(args: {
  state: LoopEngineState;
  runId: string;
  approvedBy: string;
  recoveryExecutor: RecoveryExecutor;
  probeExecutor: ProbeExecutor;
  /** When true, simulate verification failure to exercise rollback */
  forceVerifyFail?: boolean;
  /** Skip the approval gate (used by guarded autopilot after policy check). */
  skipApprovalGate?: boolean;
}): Promise<{ state: LoopEngineState; run: LoopRun }> {
  let state = args.state;
  let run = state.runs.get(args.runId);
  if (!run) throw new Error(`Run not found: ${args.runId}`);
  if (!run.actionPlan) throw new Error("No action plan on run");

  // Idempotent re-entry after process restart
  if (run.state === "recovered" || run.state === "remembered") {
    return { state, run };
  }

  const canApply =
    (run.state === "awaiting_approval" && canApplyMutation(run)) ||
    (Boolean(args.skipApprovalGate) &&
      (run.state === "awaiting_approval" || run.state === "planning") &&
      !run.sideEffects.mutationApplied);

  if (canApply) {
    // Capture pre-mutation proxy so fail-verify can reverse the applied mutation.
    const hostId = run.hostId || state.graph.hostId;
    const preContent =
      state.proxyContentByHost.get(hostId) ||
      state.lastObservation?.proxy?.configContent ||
      "";
    const preType =
      state.lastObservation?.proxy?.type ||
      ("caddy" as const);
    const preRevisionId = `rev_pre_mutation_${run.id}`;
    if (preContent) {
      const preRev: ProxyRevision = {
        id: preRevisionId,
        hostId,
        proxyType: preType === "nginx" ? "nginx" : preType === "unknown" ? "unknown" : "caddy",
        content: preContent,
        fingerprint: fingerprintContent(preContent),
        capturedAt: new Date().toISOString(),
        serviceIds: run.serviceIds,
        validated: true,
        label: "pre-mutation",
      };
      state = registerRevision(state, preRev);
      run = {
        ...run,
        preMutation: {
          proxyRevisionId: preRevisionId,
          proxyContent: preContent,
          proxyType: preRev.proxyType,
        },
      };
    }

    run = {
      ...run,
      approvedAt: new Date().toISOString(),
      approvedBy: args.skipApprovalGate ? args.approvedBy || "autopilot" : args.approvedBy,
      auditLog: [
        ...run.auditLog,
        {
          at: new Date().toISOString(),
          action: args.skipApprovalGate ? "autopilot_authorized" : "approved",
          detail: args.approvedBy,
        },
      ],
    };
    if (run.state === "planning") {
      run = transitionRun(run, "awaiting_approval", "policy authorized");
    }
    run = transitionRun(run, "applying", args.skipApprovalGate ? "autopilot apply" : "operator approved");

    const plan = run.actionPlan;
    if (!plan) {
      run = transitionRun(run, "guided", "action plan missing after approval");
      const runs = new Map(state.runs);
      runs.set(run.id, run);
      return { state: { ...state, runs }, run };
    }

    const result = await executeActionPlan(plan, {
      executor: args.recoveryExecutor,
      revisions: state.revisions,
      approved: true,
    });

    run = {
      ...markSideEffect(run, "mutationApplied"),
      actionPlan: result.plan,
    };

    if (!result.ok) {
      run = transitionRun(run, "failed", result.detail);
      run = transitionRun(run, "guided", "mutation failed — guided escalation");
      const runs = new Map(state.runs);
      runs.set(run.id, run);
      return { state: { ...state, runs }, run };
    }

    // Re-reconcile service graph from applied proxy revision so paths match recovery.
    if (
      result.plan.kind === "restore_proxy_revision" &&
      result.plan.params.proxyRevisionId
    ) {
      const rev = state.revisions.get(String(result.plan.params.proxyRevisionId));
      if (rev) {
        state = applyProxyRevisionToState(state, rev);
      }
    } else if (result.plan.kind === "reload_validated_proxy") {
      const content = state.proxyContentByHost.get(hostId);
      if (content) {
        state = applyProxyRevisionToState(state, {
          id: `rev_reload_${run.id}`,
          hostId,
          proxyType: preType === "nginx" ? "nginx" : "caddy",
          content,
          fingerprint: fingerprintContent(content),
          capturedAt: new Date().toISOString(),
          serviceIds: run.serviceIds,
          validated: true,
        });
      }
    }

    run = transitionRun(run, "verifying", "mutation applied");
    const runsMid = new Map(state.runs);
    runsMid.set(run.id, run);
    state = { ...state, runs: runsMid };
  }

  // Verification
  run = state.runs.get(args.runId)!;
  if (run.state === "verifying" && !run.sideEffects.verificationDone) {
    const journeyIds = run.actionPlan?.verificationJourneyIds || [];
    const journeys = state.journeys.filter((j) => journeyIds.includes(j.id));
    const verification = [];
    for (const j of journeys) {
      if (args.forceVerifyFail) {
        verification.push({
          journeyId: j.id,
          ok: false,
          stepResults: [
            {
              stepIndex: 0,
              ok: false,
              detail: "Forced verification failure",
              statusCode: 502,
            },
          ],
          observedAt: new Date().toISOString(),
        });
      } else {
        verification.push(await runJourney(j, args.probeExecutor));
      }
    }

    run = {
      ...markSideEffect(run, "verificationDone"),
      verification,
    };

    const ok = verification.length > 0 && verification.every((v) => v.ok);
    if (ok) {
      run = transitionRun(run, "recovered", "verification passed");
      run = transitionRun(run, "remembered", "recovery memory recorded");
      run = markSideEffect(run, "memoryRecorded");
    } else if (!run.sideEffects.rollbackDone) {
      run = transitionRun(run, "rolling_back", "verification failed");

      // Real reverse: restore pre-mutation proxy via allowlisted executor.
      const preId = run.preMutation?.proxyRevisionId;
      const preRev = preId ? state.revisions.get(preId) : undefined;

      if (preRev) {
        const rbPlan = {
          id: `plan_rollback_${run.id}`,
          kind: "restore_proxy_revision" as const,
          title: "Rollback to pre-mutation proxy",
          description: "Reverse applied mutation after failed verification",
          risk: "low" as const,
          preconditions: ["operator_or_policy"],
          affectedNodeIds: [],
          supportingEvidenceIds: [],
          expectedResult: "Proxy restored to pre-mutation content",
          verificationJourneyIds: [],
          approvalRequired: false,
          params: {
            hostId: preRev.hostId,
            proxyRevisionId: preRev.id,
          },
        };
        const rb = await executeActionPlan(rbPlan, {
          executor: args.recoveryExecutor,
          revisions: state.revisions,
          approved: true,
        });
        if (rb.ok) {
          state = applyProxyRevisionToState(state, preRev);
          run = markSideEffect(run, "rollbackDone");
          run = {
            ...run,
            actionPlan: run.actionPlan
              ? { ...run.actionPlan, rolledBack: true, rolledBackAt: new Date().toISOString() }
              : run.actionPlan,
            auditLog: [
              ...run.auditLog,
              {
                at: new Date().toISOString(),
                action: "rollback_applied",
                detail: `restored ${preRev.id} via RecoveryExecutor`,
              },
            ],
          };
          run = transitionRun(run, "guided", "rolled back after failed verification");
        } else {
          // Do NOT mark rollbackDone if reverse did not execute
          run = {
            ...run,
            auditLog: [
              ...run.auditLog,
              {
                at: new Date().toISOString(),
                action: "rollback_failed",
                detail: rb.detail,
              },
            ],
          };
          run = transitionRun(run, "failed", "rollback failed");
          run = transitionRun(run, "guided", "safe guided escalation — rollback failed");
        }
      } else {
        // No reversible snapshot — escalate without claiming rollback completed
        run = {
          ...run,
          auditLog: [
            ...run.auditLog,
            {
              at: new Date().toISOString(),
              action: "rollback_unavailable",
              detail: "no pre-mutation revision; guided escalation only",
            },
          ],
        };
        run = transitionRun(run, "guided", "guided escalation — no reversible snapshot");
      }
    }
  }

  const runs = new Map(state.runs);
  runs.set(run.id, run);
  return { state: { ...state, runs }, run };
}

export function getServicePath(state: LoopEngineState, domain: string) {
  return resolveServicePath(state.graph, domain);
}

export function getGraphSummary(state: LoopEngineState) {
  return {
    hostId: state.graph.hostId,
    source: state.graph.source,
    reconciledAt: state.graph.reconciledAt,
    nodeCount: state.graph.nodes.length,
    edgeCount: state.graph.edges.length,
    paths: listServicePaths(state.graph),
    nodes: state.graph.nodes,
    edges: state.graph.edges,
  };
}
