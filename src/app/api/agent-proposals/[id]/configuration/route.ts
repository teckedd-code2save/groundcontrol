import { NextRequest, NextResponse } from "next/server";
import { ownerProposalRequest, ownerProposalError, boundedReviewBody } from "@/lib/agent-enrollment-http";
import { saveProposalConfiguration, proposalConfigurationStatus } from "@/lib/agent-proposal-configuration";
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId=ownerProposalRequest(req,true);const {id}=await context.params;
    return NextResponse.json(await saveProposalConfiguration(userId,id,await boundedReviewBody(req)),{headers:{"Cache-Control":"no-store"}});
  } catch(error){return ownerProposalError(error);}
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId=ownerProposalRequest(req);const {id}=await context.params;
    return NextResponse.json(await proposalConfigurationStatus(userId,id),{headers:{"Cache-Control":"no-store"}});
  } catch(error){return ownerProposalError(error);}
}
