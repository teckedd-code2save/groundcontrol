import { NextRequest, NextResponse } from "next/server";
import { ownerProposalRequest, ownerProposalError } from "@/lib/agent-enrollment-http";
import { ownerDeploymentProposalContext } from "@/lib/agent-enrollment-review";
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId = ownerProposalRequest(req); const { id } = await context.params;
    return NextResponse.json(await ownerDeploymentProposalContext(userId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return ownerProposalError(error); }
}
