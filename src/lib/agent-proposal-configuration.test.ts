// @vitest-environment node
import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
let db:PrismaClient,directory:string;
vi.mock("./prisma",()=>({get prisma(){return db;}}));
import { saveProposalConfiguration,captureProposalConfiguration,proposalConfigurationStatus,normalizeProposalConfiguration } from "./agent-proposal-configuration";
import { deploymentProposalGrantHash,deploymentProposalContentHash,normalizeDeploymentProposal } from "./agent-enrollment";
import { decrypt } from "./crypto";
let userId:number,proposalId:string,contentHash:string;
beforeAll(async()=>{
 directory=mkdtempSync(join(tmpdir(),"gc-owner-config-"));const url=`file:${join(directory,"test.db")}`;
 execFileSync(process.execPath,["node_modules/prisma/build/index.js","db","push","--skip-generate"],{env:{...process.env,DATABASE_URL:url},stdio:"pipe"});db=new PrismaClient({datasourceUrl:url});
 vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS","1");vi.stubEnv("GROUNDCONTROL_SECRET","a".repeat(64));
 const user=await db.user.create({data:{username:"owner",password:"test"}});userId=user.id;
 const client=await db.oAuthClient.create({data:{clientId:"agent",clientName:"Agent"}});
 const grant=await db.oAuthGrant.create({data:{userId,clientDbId:client.id,scope:"deployment:propose"}});
 const input=normalizeDeploymentProposal({repositoryUrl:"https://github.com/example/app",revision:"a".repeat(40),runtime:"compose",composePath:"compose.yml",workloadName:"candidate"});contentHash=deploymentProposalContentHash(input);
 proposalId=(await db.agentDeploymentProposal.create({data:{grantId:grant.id,userId,idempotencyKey:"config-test-001",inputJson:JSON.stringify(input),contentHash,grantHash:deploymentProposalGrantHash(grant),expiresAt:new Date(Date.now()+600000)}})).id;
},30000);
afterAll(async()=>{if(db)await db.$disconnect();if(directory)rmSync(directory,{recursive:true,force:true});vi.unstubAllEnvs();});
it("creates only a fresh candidate profile and stores encrypted versions, never returning values",async()=>{
 const prod=await db.project.create({data:{slug:"production",name:"Production",path:"/prod",envVars:'{"SECRET":"DO_NOT_COPY"}'}});
 const response=await saveProposalConfiguration(userId,proposalId,{contentHash,expectedRevision:0,values:[{service:"web",key:"QLOO_API_KEY",value:"SYNTHETIC_SECRET",required:true}]});
 expect(response.projectId).not.toBe(prod.id);expect(JSON.stringify(response)).not.toMatch(/SYNTHETIC|DO_NOT_COPY/);
 const row=await db.deploymentEnvValue.findFirstOrThrow({where:{profileId:response.profileId}});expect(row.value).toMatch(/^enc:v1:/);expect(decrypt(row.value)).toBe("SYNTHETIC_SECRET");
 expect((await db.project.findUniqueOrThrow({where:{id:prod.id}})).envVars).toContain("DO_NOT_COPY");
 const captured=await captureProposalConfiguration(userId,proposalId,["web"]);expect(captured?.missing).toEqual([]);expect(JSON.stringify(captured)).not.toContain("SYNTHETIC");
 expect(JSON.stringify(await proposalConfigurationStatus(userId,proposalId))).not.toContain("SYNTHETIC");
});
it("rejects stale revision without changing saved values",async()=>{
 await expect(saveProposalConfiguration(userId,proposalId,{contentHash,expectedRevision:0,values:[]})).rejects.toThrow(/reload/);
 expect(await db.deploymentEnvValue.count()).toBe(1);
});
it("rejects arbitrary profiles, wrong owner and malformed value fields",async()=>{
 expect(()=>normalizeProposalConfiguration({contentHash,expectedRevision:1,profileId:999,values:[]})).toThrow();
 await expect(saveProposalConfiguration(userId+100,proposalId,{contentHash,expectedRevision:1,values:[]})).rejects.toThrow();
});
it("preserves omitted saved candidate keys while adding another key",async()=>{
 await saveProposalConfiguration(userId,proposalId,{contentHash,expectedRevision:1,values:[{service:"web",key:"APP_ORIGIN",value:"https://candidate.example",required:true}]});
 const original=await db.deploymentEnvValue.findFirstOrThrow({where:{key:"QLOO_API_KEY"}});expect(decrypt(original.value)).toBe("SYNTHETIC_SECRET");expect(original.version).toBe(1);
});
it("records deletion in version history and never copies other profile values",async()=>{
 await saveProposalConfiguration(userId,proposalId,{contentHash,expectedRevision:2,values:[],removeKeys:[{service:"web",key:"QLOO_API_KEY"}]});
 expect(await db.deploymentEnvValue.count()).toBe(1);expect(await db.deploymentEnvValueVersion.count({where:{state:"deleted"}})).toBe(1);
});
