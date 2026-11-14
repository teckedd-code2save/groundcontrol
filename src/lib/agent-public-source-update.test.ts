// @vitest-environment node
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ path: `/tmp/gc-public-update-${process.pid}.db` }));
vi.mock("./prisma", async () => { const { PrismaClient } = await import("@prisma/client"); return { prisma: new PrismaClient({ datasourceUrl: `file:${state.path}` }) }; });
import { prisma } from "./prisma";
import { claimAgentPublicSourceUpdate, recordPublicSourceUpdateEvidence, finishAgentPublicSourceUpdate } from "./agent-public-source-update";
import { runtimeIdentity } from "./agent-runtime-capabilities";
import { planAgentFirstDeploy } from "./agent-first-deploy-plan";
import { prepareFirstDeployExecution } from "./agent-first-deploy-execution";
let userId: number, grantId: number, deploymentId: number, recipeHash: string;
let operationId: string, secondOperationId: string;
let prepared: ReturnType<typeof prepareFirstDeployExecution>;
beforeAll(() => { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: { ...process.env, DATABASE_URL: `file:${state.path}` }, stdio: "pipe" }); },30000);
beforeEach(async () => {
 vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS","1");
 await prisma.agentDeploymentRecipe.deleteMany(); await prisma.agentOperation.deleteMany(); await prisma.enrolledDeployment.deleteMany(); await prisma.oAuthGrant.deleteMany(); await prisma.oAuthClient.deleteMany(); await prisma.user.deleteMany(); await prisma.vpsConfig.deleteMany();
 const user = await prisma.user.create({ data:{username:"owner",password:"test"} }); userId=user.id;
 const client = await prisma.oAuthClient.create({data:{clientId:"agent",clientName:"Agent"}});
 const host = await prisma.vpsConfig.create({data:{host:"192.0.2.1"}});
 const input={proposalId:"proposal_12345",repositoryUrl:"https://github.com/example/app",commitSha:"a".repeat(40),composeFile:"compose.yml",composeYaml:"services:\n  app:\n    build: .\n    ports: ['127.0.0.1:8080:80']\n"};
 const recipe={...input,recipeHash:planAgentFirstDeploy(input).recipeHash,health:{service:"app",port:8080,path:"/"},budget:{maxServices:2,cpusPerService:.5,memoryMbPerService:256,pidsPerService:64,timeoutSeconds:120},allowUnboundedBuildResources:true}; prepared=prepareFirstDeployExecution(recipe);
 const recipeJson=JSON.stringify({recipe,host:{id:host.id,host:host.host,port:host.port,username:host.username,isLocal:host.isLocal,authType:host.authType,updatedAt:host.updatedAt.toISOString()},version:1}); recipeHash=createHash("sha256").update(recipeJson).digest("hex");
 const dep=await prisma.enrolledDeployment.create({data:{name:"app",slug:"app",kind:"compose",vpsConfigId:host.id,sourcePath:prepared.plan.deploymentPath,composePath:prepared.composePath,metadataJson:JSON.stringify({agentEnrollment:{recipeHash,firstLaunchState:"success"}})}});deploymentId=dep.id;
 const grant=await prisma.oAuthGrant.create({data:{userId,clientDbId:client.id,scope:"deployment:redeploy",resources:JSON.stringify([deploymentId])}});grantId=grant.id;
 await prisma.agentDeploymentRecipe.create({data:{proposalId:input.proposalId,reviewId:"review_1",deploymentId,vpsConfigId:host.id,deploymentPath:prepared.plan.deploymentPath,userId,recipeJson,recipeHash,status:"success"}});
 const op={grantId,deploymentId,type:"deployment.source.deploy",status:"running",inputJson:JSON.stringify({recipeHash,publicSourceRecipe:true,commitSha:"b".repeat(40),runtimeIdentity:runtimeIdentity(dep)})};
 operationId=(await prisma.agentOperation.create({data:{...op,idempotencyKey:"launch-first"}})).id;
 secondOperationId=(await prisma.agentOperation.create({data:{...op,idempotencyKey:"launch-second"}})).id;
});
afterAll(async()=>{vi.unstubAllEnvs();await prisma.$disconnect();rmSync(state.path,{force:true});});

const claim=(id=operationId)=>claimAgentPublicSourceUpdate(deploymentId,id,grantId,userId);
it("serializes source updates and refuses duplicate execution",async()=>{
 const outcomes=await Promise.allSettled([claim(),claim(secondOperationId)]);
 expect(outcomes.filter(x=>x.status==="fulfilled")).toHaveLength(1);
 expect((await prisma.agentDeploymentRecipe.findUniqueOrThrow({where:{deploymentId}})).status).toBe("updating");
 await expect(claim()).rejects.toThrow();
});
it("retains current paths on uncertainty and refuses a fresh-key replay",async()=>{
 const state=await claim();
 await finishAgentPublicSourceUpdate(deploymentId,operationId,{success:false,status:"uncertain",hostMutation:"possible",phase:"launch_started",deploymentPath:state.prepared.plan.deploymentPath,composePath:state.prepared.composePath,composeProject:state.prepared.composeProject,commitSha:"b".repeat(40),loopbackVerified:false,publicVerified:false});
 const dep=await prisma.enrolledDeployment.findUniqueOrThrow({where:{id:deploymentId}});
 expect(dep.sourcePath).toBe(prepared.plan.deploymentPath);
 expect(dep.status).toBe("uncertain");
 await expect(claim(secondOperationId)).rejects.toThrow(/unresolved/);
});
it("only switches current paths and revision on confirmed success",async()=>{
 const state=await claim();
 await finishAgentPublicSourceUpdate(deploymentId,operationId,{success:true,status:"success",hostMutation:"confirmed",phase:"verified",deploymentPath:state.prepared.plan.deploymentPath,composePath:state.prepared.composePath,composeProject:state.prepared.composeProject,commitSha:"b".repeat(40),loopbackVerified:true,publicVerified:false});
 const dep=await prisma.enrolledDeployment.findUniqueOrThrow({where:{id:deploymentId}});
 expect(dep.sourcePath).toBe(state.prepared.plan.deploymentPath);
 expect(JSON.parse(dep.metadataJson).agentEnrollment.currentCommitSha).toBe("b".repeat(40));
 expect((await prisma.agentDeploymentRecipe.findUniqueOrThrow({where:{deploymentId}})).recipeHash).toBe(recipeHash);
 await expect(claim(secondOperationId)).rejects.toThrow(/Deployment changed/);
});
it("checks revoked grants again before each host phase",async()=>{
 await claim();await prisma.oAuthGrant.update({where:{id:grantId},data:{revokedAt:new Date()}});
 await expect(recordPublicSourceUpdateEvidence(deploymentId,operationId,grantId,userId,{phase:"launch"})).rejects.toThrow(/authorized/);
});
it("rejects SHA, host or immutable recipe tampering",async()=>{
 const op=await prisma.agentOperation.findUniqueOrThrow({where:{id:operationId}});
 await prisma.agentOperation.update({where:{id:operationId},data:{inputJson:JSON.stringify({...JSON.parse(op.inputJson),commitSha:"main"})}});
 await expect(claim()).rejects.toThrow(/commit SHA/);
 await prisma.agentOperation.update({where:{id:operationId},data:{inputJson:op.inputJson}});
 await prisma.vpsConfig.updateMany({data:{host:"192.0.2.8"}});
 await expect(claim()).rejects.toThrow(/host/);
});
