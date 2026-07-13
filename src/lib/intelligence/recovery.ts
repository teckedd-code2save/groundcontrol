import type {
  ActionPlan,
  AllowlistedActionKind,
  LoopRun,
  ProxyRevision,
} from "./types";

const ALLOWLIST: ReadonlySet<AllowlistedActionKind> = new Set([
  "restore_proxy_revision",
  "reload_validated_proxy",
  "restart_stateless_service",
  "redeploy_previous_healthy_artifact",
  "noop_guided",
]);

export function isAllowlistedAction(kind: string): kind is AllowlistedActionKind {
  return ALLOWLIST.has(kind as AllowlistedActionKind);
}

export function createRestoreProxyPlan(args: {
  proxyRevisionId: string;
  domain?: string;
  hostId: string;
  evidenceIds: string[];
  journeyIds: string[];
}): ActionPlan {
  return {
    id: `plan_restore_proxy_${args.proxyRevisionId}`,
    kind: "restore_proxy_revision",
    title: "Restore last known-good proxy configuration",
    description: args.domain
      ? `Restore proxy revision for ${args.domain} to a previously validated configuration.`
      : "Restore proxy revision to a previously validated configuration.",
    risk: "low",
    preconditions: [
      "proxy_revision_exists",
      "revision_previously_validated",
      "operator_approval",
    ],
    affectedNodeIds: [],
    supportingEvidenceIds: args.evidenceIds,
    expectedResult: "Public routes return healthy status codes on verification journeys.",
    verificationJourneyIds: args.journeyIds,
    rollbackKind: "restore_proxy_revision",
    approvalRequired: true,
    params: {
      hostId: args.hostId,
      proxyRevisionId: args.proxyRevisionId,
      domain: args.domain,
    },
  };
}

export function createRestartStatelessPlan(args: {
  containerName: string;
  serviceId?: string;
  hostId: string;
  evidenceIds: string[];
  journeyIds: string[];
}): ActionPlan {
  return {
    id: `plan_restart_${args.containerName}`,
    kind: "restart_stateless_service",
    title: `Restart stateless container ${args.containerName}`,
    description: "Restart a single unhealthy stateless container. Not for databases or volumes.",
    risk: "medium",
    preconditions: ["container_is_stateless", "operator_approval"],
    affectedNodeIds: [],
    supportingEvidenceIds: args.evidenceIds,
    expectedResult: "Container returns to running and journeys pass.",
    verificationJourneyIds: args.journeyIds,
    rollbackKind: "redeploy_previous_healthy_artifact",
    approvalRequired: true,
    params: {
      hostId: args.hostId,
      containerName: args.containerName,
      serviceId: args.serviceId,
    },
  };
}

export function createRedeployArtifactPlan(args: {
  artifactRef: string;
  serviceId?: string;
  hostId: string;
  evidenceIds: string[];
  journeyIds: string[];
}): ActionPlan {
  return {
    id: `plan_redeploy_${args.artifactRef.slice(0, 24)}`,
    kind: "redeploy_previous_healthy_artifact",
    title: "Redeploy previous healthy artifact",
    description: `Redeploy immutable artifact ${args.artifactRef}.`,
    risk: "medium",
    preconditions: ["artifact_available", "operator_approval"],
    affectedNodeIds: [],
    supportingEvidenceIds: args.evidenceIds,
    expectedResult: "Previous artifact is running and journeys pass.",
    verificationJourneyIds: args.journeyIds,
    approvalRequired: true,
    params: {
      hostId: args.hostId,
      artifactRef: args.artifactRef,
      serviceId: args.serviceId,
    },
  };
}

export function createGuidedNoopPlan(reason: string): ActionPlan {
  return {
    id: `plan_guided_${Date.now()}`,
    kind: "noop_guided",
    title: "Guided recovery — automation paused",
    description: reason,
    risk: "low",
    preconditions: [],
    affectedNodeIds: [],
    supportingEvidenceIds: [],
    expectedResult: "Operator executes manual steps with GroundControl guidance.",
    verificationJourneyIds: [],
    approvalRequired: false,
    params: { reason },
  };
}

/**
 * Execution context for allowlisted actions.
 * Real host mutations go through explicit methods — never freeform shell from the model.
 */
export interface RecoveryExecutor {
  restoreProxyRevision(revision: ProxyRevision): Promise<{ ok: boolean; detail: string }>;
  reloadProxy(proxyType: string): Promise<{ ok: boolean; detail: string }>;
  restartContainer(containerName: string): Promise<{ ok: boolean; detail: string }>;
  redeployArtifact(artifactRef: string, serviceId?: string): Promise<{ ok: boolean; detail: string }>;
}

/**
 * Apply an approved action plan via allowlisted intents only.
 * Rejects unknown kinds. Does not accept freeform shell commands.
 */
export async function executeActionPlan(
  plan: ActionPlan,
  ctx: {
    executor: RecoveryExecutor;
    revisions: Map<string, ProxyRevision>;
    /** Must be true — enforces approval gate */
    approved: boolean;
  }
): Promise<{ ok: boolean; detail: string; plan: ActionPlan }> {
  if (!isAllowlistedAction(plan.kind)) {
    return {
      ok: false,
      detail: `Action kind not allowlisted: ${plan.kind}`,
      plan,
    };
  }

  if (plan.approvalRequired && !ctx.approved) {
    return {
      ok: false,
      detail: "Approval required before mutation",
      plan,
    };
  }

  if (plan.kind === "noop_guided") {
    return {
      ok: true,
      detail: "Guided plan recorded; no mutation executed",
      plan: { ...plan, executed: true, executedAt: new Date().toISOString(), result: "guided" },
    };
  }

  let result: { ok: boolean; detail: string };

  switch (plan.kind) {
    case "restore_proxy_revision": {
      const revId = String(plan.params.proxyRevisionId || "");
      const rev = ctx.revisions.get(revId);
      if (!rev) {
        result = { ok: false, detail: `Proxy revision not found: ${revId}` };
        break;
      }
      result = await ctx.executor.restoreProxyRevision(rev);
      break;
    }
    case "reload_validated_proxy": {
      result = await ctx.executor.reloadProxy(String(plan.params.proxyType || "caddy"));
      break;
    }
    case "restart_stateless_service": {
      const name = String(plan.params.containerName || "");
      if (!name) {
        result = { ok: false, detail: "containerName required" };
        break;
      }
      result = await ctx.executor.restartContainer(name);
      break;
    }
    case "redeploy_previous_healthy_artifact": {
      const artifact = String(plan.params.artifactRef || "");
      if (!artifact) {
        result = { ok: false, detail: "artifactRef required" };
        break;
      }
      result = await ctx.executor.redeployArtifact(
        artifact,
        plan.params.serviceId ? String(plan.params.serviceId) : undefined
      );
      break;
    }
    default:
      result = { ok: false, detail: `Unhandled allowlisted kind` };
  }

  const updated: ActionPlan = {
    ...plan,
    executed: true,
    executedAt: new Date().toISOString(),
    result: result.detail,
  };

  return { ok: result.ok, detail: result.detail, plan: updated };
}

/**
 * In-memory fixture executor that simulates host mutations without shell.
 */
export function createFixtureRecoveryExecutor(state: {
  proxyContent: string;
  containerStates: Record<string, string>;
  artifacts?: Record<string, string>;
}): RecoveryExecutor & { state: typeof state } {
  const exec: RecoveryExecutor & { state: typeof state } = {
    state,
    async restoreProxyRevision(revision) {
      state.proxyContent = revision.content;
      return { ok: true, detail: `Restored proxy revision ${revision.id}` };
    },
    async reloadProxy(proxyType) {
      return { ok: true, detail: `Reloaded ${proxyType}` };
    },
    async restartContainer(containerName) {
      state.containerStates[containerName] = "running";
      return { ok: true, detail: `Restarted ${containerName}` };
    },
    async redeployArtifact(artifactRef, serviceId) {
      if (state.artifacts) state.artifacts[serviceId || "default"] = artifactRef;
      return { ok: true, detail: `Redeployed ${artifactRef}` };
    },
  };
  return exec;
}

/**
 * Validate proxy config text with native validators when a runner is provided.
 * Fixture path uses heuristic validation only.
 */
export function validateProxyConfig(
  content: string,
  proxyType: "caddy" | "nginx" | "unknown"
): { ok: boolean; detail: string } {
  if (!content || !content.trim()) {
    return { ok: false, detail: "Empty proxy configuration" };
  }
  if (proxyType === "caddy") {
    // Minimal structural checks — native `caddy validate` is used by live adapters
    if (!/\{\s*$/m.test(content) && !content.includes("{")) {
      // Caddyfile site blocks usually have braces; allow simple reverse_proxy one-liners
      if (!/reverse_proxy/.test(content) && !/^\S+\s*$/m.test(content)) {
        return { ok: false, detail: "Caddyfile does not look like valid site config" };
      }
    }
    return { ok: true, detail: "Heuristic Caddy validation passed" };
  }
  if (proxyType === "nginx") {
    if (!/server\s*\{/.test(content) && !/listen\s+/.test(content)) {
      return { ok: false, detail: "Nginx config missing server/listen directives" };
    }
    return { ok: true, detail: "Heuristic Nginx validation passed" };
  }
  return { ok: true, detail: "Unknown proxy type — skipped strict validation" };
}

export function fingerprintContent(content: string): string {
  let h = 2166136261;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Ensure loop run has not already applied mutation (restart idempotency).
 */
export function canApplyMutation(run: LoopRun): boolean {
  return !run.sideEffects.mutationApplied && run.state === "awaiting_approval";
}

export function canRollback(run: LoopRun): boolean {
  return (
    run.sideEffects.mutationApplied &&
    !run.sideEffects.rollbackDone &&
    (run.state === "verifying" || run.state === "rolling_back" || run.state === "failed")
  );
}
