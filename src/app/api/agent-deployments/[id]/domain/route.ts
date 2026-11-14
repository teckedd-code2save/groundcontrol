import { NextRequest, NextResponse } from "next/server";
import { ownerProposalRequest } from "@/lib/agent-enrollment-http";
import { appDomainError } from "@/lib/agent-app-domain-http";
import { getAgentAppDomainPublication } from "@/lib/agent-app-domain-publish";
export async function GET(req:NextRequest,context:{params:Promise<{id:string}>}){
  try{const userId=ownerProposalRequest(req);const {id}=await context.params;return NextResponse.json(await getAgentAppDomainPublication(userId,Number(id),req.nextUrl.searchParams.get("reviewId")||""),{headers:{"Cache-Control":"no-store"}});}catch(error){return appDomainError(error);}
}
