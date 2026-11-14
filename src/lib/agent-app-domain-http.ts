import { NextResponse } from "next/server";
export function appDomainError(error:unknown){
  const message=error instanceof Error?error.message:"";
  const safe=/^(Unauthorized$|Same-origin|Explicit |Invalid |Choose |Use |Supply |An exact |Application publishing|A current administrator|A successfully launched|The approved health|Idempotency key|Publication |Approved host|Domain prerequisites)/.test(message)?message:"Application domain setup could not finish. Check the reviewed host, DNS and Caddy prerequisites.";
  return NextResponse.json({error:safe},{status:message==="Unauthorized"?401:message.startsWith("Same-origin")?403:400,headers:{"Cache-Control":"no-store"}});
}
