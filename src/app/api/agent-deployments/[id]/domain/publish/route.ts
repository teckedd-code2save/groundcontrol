import { NextRequest, NextResponse } from "next/server";
import { ownerProposalRequest, boundedReviewBody } from "@/lib/agent-enrollment-http";
import { appDomainError } from "@/lib/agent-app-domain-http";
import { publishAgentAppDomain } from "@/lib/agent-app-domain-publish";
export async function POST(req:NextRequest,context:{params:Promise<{id:string}>}){
  try{const userId=ownerProposalRequest(req,true);const {id}=await context.params;return NextResponse.json(await publishAgentAppDomain(userId,Number(id),await boundedReviewBody(req)),{headers:{"Cache-Control":"no-store"}});}catch(error){return appDomainError(error);}
}
