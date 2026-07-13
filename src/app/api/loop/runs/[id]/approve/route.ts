import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { auditLog, getClientInfo } from "@/lib/audit";
import {
  getLoopEngine,
  setLoopEngine,
  getRun,
  approveAndRecover,
  createFixtureRecoveryExecutor,
  createLiveRecoveryExecutor,
  shouldUseLiveRecovery,
  createMapProbeExecutor,
  fixtureWrongUpstreamPort,
  evaluatePolicy,
  canAutopilotApply,
  DEFAULT_AUTOPILOT_POLICY,
  type AutonomyMode,
} from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

/**
 * Approve the current allowlisted action plan and run verify (and rollback if needed).
 * Mutations only via RecoveryExecutor intents — never model-authored shell.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = requireAuth(req);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      forceVerifyFail?: boolean;
      probeStatus?: number;
      /** Request autopilot path when policy allows (default false). */
      autopilot?: boolean;
      autonomyMode?: AutonomyMode;
    };

    const existing = getRun(id);
    if (!existing) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    if (existing.state !== "awaiting_approval" && existing.state !== "verifying" && existing.state !== "planning") {
      // Allow idempotent re-fetch after recovery
      if (
        existing.state === "remembered" ||
        existing.state === "recovered" ||
        existing.state === "guided"
      ) {
        return NextResponse.json({
          run: existing,
          maturity: existing.isFixture ? "fixture" : "early_access",
          note: "Run already past approval gate",
        });
      }
      return NextResponse.json(
        { error: `Run not awaiting approval (state=${existing.state})` },
        { status: 409 }
      );
    }

    const state = getLoopEngine();
    const fx = fixtureWrongUpstreamPort();
    const proxyContent =
      state.proxyContentByHost.get(existing.hostId) ||
      fx.brokenRevision.content;

    const live = shouldUseLiveRecovery() && !existing.isFixture;
    const fixtureExecutor = createFixtureRecoveryExecutor({
      proxyContent,
      containerStates: { web: "running", api: "running" },
    });
    const recoveryExecutor = live
      ? createLiveRecoveryExecutor()
      : fixtureExecutor;

    const probeStatus = body.probeStatus ?? (body.forceVerifyFail ? 502 : 200);
    const probeExecutor = createMapProbeExecutor({
      [fx.publicUrl]: probeStatus,
      "https://api.example.com/health": probeStatus,
    });

    const policy = {
      ...DEFAULT_AUTOPILOT_POLICY,
      mode: body.autonomyMode || DEFAULT_AUTOPILOT_POLICY.mode,
    };
    const policyDecision = evaluatePolicy(existing.actionPlan, policy);
    const skipApprovalGate =
      Boolean(body.autopilot) &&
      canAutopilotApply(existing, policy) &&
      policyDecision.decision === "autopilot_execute";

    if (body.autopilot && !skipApprovalGate) {
      return NextResponse.json(
        {
          error: "Autopilot not authorized for this plan",
          policyDecision,
        },
        { status: 403 }
      );
    }

    const result = await approveAndRecover({
      state,
      runId: id,
      approvedBy: skipApprovalGate ? `autopilot:${user.username}` : user.username,
      recoveryExecutor,
      probeExecutor,
      forceVerifyFail: body.forceVerifyFail,
      skipApprovalGate,
    });

    // Engine state already re-reconciles graph; mirror fixture executor content if used
    if (!live && "state" in fixtureExecutor) {
      const proxyContentByHost = new Map(result.state.proxyContentByHost);
      proxyContentByHost.set(existing.hostId, fixtureExecutor.state.proxyContent);
      // applyProxyRevisionToState already ran inside orchestrator when revision known
      setLoopEngine({ ...result.state, proxyContentByHost });
    } else {
      setLoopEngine(result.state);
    }

    try {
      await auditLog({
        userId: user.id,
        action: "ai_tool_confirm",
        metadata: {
          loopRunId: id,
          actionKind: result.run.actionPlan?.kind,
          state: result.run.state,
          mutationApplied: result.run.sideEffects.mutationApplied,
        },
        context: getClientInfo(req),
      });
    } catch {
      // audit failure must not block recovery response
    }

    return NextResponse.json({
      run: result.run,
      maturity: result.run.isFixture ? "fixture" : live ? "live" : "early_access",
      policyDecision,
      autopilot: skipApprovalGate,
      liveRecovery: live,
      note: skipApprovalGate
        ? "Guarded autopilot executed allowlisted low-risk action only."
        : "Approved recovery uses allowlisted actions only.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
