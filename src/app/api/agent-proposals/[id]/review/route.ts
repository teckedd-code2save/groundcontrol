import { NextRequest, NextResponse } from "next/server";
import { ownerProposalRequest, ownerProposalError, boundedReviewBody } from "@/lib/agent-enrollment-http";
import { reviewOwnerDeploymentProposal } from "@/lib/agent-enrollment-review";
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId = ownerProposalRequest(req, true); const { id } = await context.params;
    return NextResponse.json(await reviewOwnerDeploymentProposal(userId, id, await boundedReviewBody(req)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return ownerProposalError(error); }
}
