import type { LoopRun, LoopRunState } from "./types";

const TRANSITIONS: Record<LoopRunState, LoopRunState[]> = {
  observed: ["correlating", "cancelled"],
  correlating: ["stabilized", "cancelled"],
  stabilized: ["exercising", "cancelled"],
  exercising: ["verified_healthy", "investigating", "cancelled"],
  verified_healthy: ["remembered", "cancelled"],
  investigating: ["guided", "planning", "failed", "cancelled"],
  guided: ["cancelled", "planning"],
  planning: ["awaiting_approval", "guided", "cancelled"],
  awaiting_approval: ["applying", "guided", "cancelled"],
  applying: ["verifying", "failed", "guided", "cancelled"],
  verifying: ["recovered", "rolling_back", "failed", "cancelled"],
  rolling_back: ["investigating", "guided", "failed", "cancelled"],
  recovered: ["remembered", "cancelled"],
  remembered: [],
  failed: ["guided", "cancelled"],
  cancelled: [],
};

export function canTransition(from: LoopRunState, to: LoopRunState): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

export function transitionRun(
  run: LoopRun,
  to: LoopRunState,
  detail?: string
): LoopRun {
  if (run.state === to) return run;
  if (!canTransition(run.state, to)) {
    throw new Error(`Invalid Loop transition ${run.state} → ${to}`);
  }
  const at = new Date().toISOString();
  return {
    ...run,
    state: to,
    updatedAt: at,
    auditLog: [
      ...run.auditLog,
      { at, action: `transition:${to}`, detail },
    ],
  };
}

export function createLoopRun(args: {
  id: string;
  hostId: string;
  serviceIds?: string[];
  eventIds?: string[];
  changeSetId?: string;
  isFixture?: boolean;
  label?: string;
}): LoopRun {
  const at = new Date().toISOString();
  return {
    id: args.id,
    hostId: args.hostId,
    state: "observed",
    changeSetId: args.changeSetId,
    serviceIds: args.serviceIds || [],
    eventIds: args.eventIds || [],
    journeyResults: [],
    createdAt: at,
    updatedAt: at,
    sideEffects: {
      journeysRun: false,
      investigationDone: false,
      mutationApplied: false,
      verificationDone: false,
      rollbackDone: false,
      memoryRecorded: false,
    },
    auditLog: [{ at, action: "created", detail: args.label }],
    label: args.label,
    isFixture: args.isFixture,
  };
}

/** Mark a side effect only once — restart-safe. */
export function markSideEffect(
  run: LoopRun,
  key: keyof LoopRun["sideEffects"]
): LoopRun {
  if (run.sideEffects[key]) return run;
  return {
    ...run,
    sideEffects: { ...run.sideEffects, [key]: true },
    updatedAt: new Date().toISOString(),
    auditLog: [
      ...run.auditLog,
      { at: new Date().toISOString(), action: `side_effect:${key}` },
    ],
  };
}
