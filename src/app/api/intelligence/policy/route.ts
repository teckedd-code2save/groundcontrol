import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  DEFAULT_AUTOPILOT_POLICY,
  evaluatePolicy,
  type AutonomyMode,
  type AutopilotPolicy,
  type AllowlistedActionKind,
  type ActionPlan,
} from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

const g = globalThis as unknown as { __gcLoopPolicy?: AutopilotPolicy };

export function getLoopPolicy(): AutopilotPolicy {
  return g.__gcLoopPolicy || { ...DEFAULT_AUTOPILOT_POLICY };
}

export function setLoopPolicy(policy: AutopilotPolicy): void {
  g.__gcLoopPolicy = policy;
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return NextResponse.json({
      policy: getLoopPolicy(),
      note: "Autopilot only executes allowlisted low-risk actions. Model confidence cannot widen permissions.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json()) as Partial<AutopilotPolicy> & {
      mode?: AutonomyMode;
    };
    const current = getLoopPolicy();
    const next: AutopilotPolicy = {
      ...current,
      ...body,
      allowed: (body.allowed as AllowlistedActionKind[]) || current.allowed,
      mode: body.mode || current.mode,
    };
    // Never allow prohibited list to be emptied of shell ban
    if (!next.prohibited.includes("execute_model_authored_shell")) {
      next.prohibited = [...next.prohibited, "execute_model_authored_shell"];
    }
    setLoopPolicy(next);
    return NextResponse.json({ policy: next });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST evaluate a plan against current policy (read-only). */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json()) as { plan?: ActionPlan };
    if (!body.plan) {
      return NextResponse.json({ error: "plan required" }, { status: 400 });
    }
    const decision = evaluatePolicy(body.plan, getLoopPolicy());
    return NextResponse.json({ decision, policy: getLoopPolicy() });
  } catch (err) {
    return errorResponse(err);
  }
}
