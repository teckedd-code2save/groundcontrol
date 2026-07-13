import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { auditLog, getClientInfo } from "@/lib/audit";
import {
  getLoopEngine,
  setLoopEngine,
  getRun,
  approveAndRecover,
  createLiveRecoveryExecutor,
  shouldUseLiveRecovery,
  createHttpProbeExecutor,
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
          maturity: "early_access",
          note: "Run already past approval gate",
        });
      }
      return NextResponse.json(
        { error: `Run not awaiting approval (state=${existing.state})` },
        { status: 409 }
      );
    }

    if (existing.isFixture) {
      return NextResponse.json({ error: "Fixture runs cannot execute recovery." }, { status: 409 });
    }
    const live = shouldUseLiveRecovery();
    if (!live) {
      return NextResponse.json(
        { error: "Live recovery is disabled. Enable it only after host actions and verification are configured." },
        { status: 503 }
      );
    }
    const state = getLoopEngine();
    const recoveryExecutor = createLiveRecoveryExecutor();
    const probeExecutor = createHttpProbeExecutor();

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
      skipApprovalGate,
    });

    setLoopEngine(result.state);

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
      maturity: "live",
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
