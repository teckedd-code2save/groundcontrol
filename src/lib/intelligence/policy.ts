/**
 * M5 — Guarded autopilot policy.
 * Enforced outside the model. Model confidence cannot widen permissions.
 */

import type { ActionPlan, AllowlistedActionKind, LoopRun } from "./types";

export type AutonomyMode = "monitor" | "guide" | "approve" | "autopilot" | "locked";

export interface AutopilotPolicy {
  mode: AutonomyMode;
  allowed: AllowlistedActionKind[];
  approvalRequired: string[];
  prohibited: string[];
  /** Max automatic mutations per hour for this service/host */
  maxActionsPerHour: number;
  actionBudgetRemaining: number;
}

export const DEFAULT_AUTOPILOT_POLICY: AutopilotPolicy = {
  mode: "approve",
  allowed: [
    "restore_proxy_revision",
    "reload_validated_proxy",
    "restart_stateless_service",
    "redeploy_previous_healthy_artifact",
  ],
  approvalRequired: [
    "change_environment_schema",
    "modify_compose_topology",
    "change_firewall",
    "apply_code_patch",
    "restart_database",
  ],
  prohibited: [
    "delete_persistent_volume",
    "destructive_database_operation",
    "expose_secret",
    "execute_model_authored_shell",
  ],
  maxActionsPerHour: 10,
  actionBudgetRemaining: 10,
};

export type PolicyDecision =
  | { decision: "monitor_only"; reason: string }
  | { decision: "guide"; reason: string }
  | { decision: "require_approval"; reason: string }
  | { decision: "autopilot_execute"; reason: string }
  | { decision: "blocked"; reason: string };

/**
 * Decide whether an action plan may auto-execute, needs approval, or is blocked.
 */
export function evaluatePolicy(
  plan: ActionPlan | undefined,
  policy: AutopilotPolicy = DEFAULT_AUTOPILOT_POLICY
): PolicyDecision {
  if (!plan) {
    return { decision: "guide", reason: "No action plan" };
  }

  if (policy.mode === "locked") {
    return { decision: "blocked", reason: "Service is locked — never mutate" };
  }

  if (policy.mode === "monitor") {
    return { decision: "monitor_only", reason: "Monitor mode — observe and verify only" };
  }

  if (policy.prohibited.includes(plan.kind) || plan.kind === ("execute_model_authored_shell" as AllowlistedActionKind)) {
    return { decision: "blocked", reason: `Prohibited action: ${plan.kind}` };
  }

  // Reject any plan that smuggles shell
  if (plan.params.command || plan.params.shell || plan.params.script) {
    return {
      decision: "blocked",
      reason: "Plan contains freeform command/shell params — blocked",
    };
  }

  if (plan.risk === "destructive") {
    return { decision: "blocked", reason: "Destructive risk cannot run in any auto mode" };
  }

  if (policy.mode === "guide") {
    return { decision: "guide", reason: "Guide mode — prepare steps only" };
  }

  if (policy.mode === "approve") {
    return {
      decision: "require_approval",
      reason: "Approve mode — operator must approve before mutation",
    };
  }

  // autopilot
  if (!policy.allowed.includes(plan.kind)) {
    return {
      decision: "require_approval",
      reason: `Action ${plan.kind} not in autopilot allowlist`,
    };
  }

  if (plan.risk !== "low") {
    return {
      decision: "require_approval",
      reason: `Autopilot only for low risk (got ${plan.risk})`,
    };
  }

  if (policy.actionBudgetRemaining <= 0) {
    return {
      decision: "require_approval",
      reason: "Autopilot action budget exhausted",
    };
  }

  if (plan.kind === "noop_guided") {
    return { decision: "guide", reason: "Guided noop — no mutation" };
  }

  return {
    decision: "autopilot_execute",
    reason: `Allowlisted low-risk action ${plan.kind} within budget`,
  };
}

/**
 * Whether a Loop run may auto-apply under current policy.
 */
export function canAutopilotApply(
  run: LoopRun,
  policy: AutopilotPolicy = DEFAULT_AUTOPILOT_POLICY
): boolean {
  if (run.sideEffects.mutationApplied) return false;
  const decision = evaluatePolicy(run.actionPlan, policy);
  return decision.decision === "autopilot_execute";
}

export function consumeAutopilotBudget(
  policy: AutopilotPolicy
): AutopilotPolicy {
  return {
    ...policy,
    actionBudgetRemaining: Math.max(0, policy.actionBudgetRemaining - 1),
  };
}
