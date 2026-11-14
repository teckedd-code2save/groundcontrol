// @vitest-environment node
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ path: `/tmp/gc-first-claim-${process.pid}.db` }));
vi.mock("./prisma", async () => { const { PrismaClient } = await import("@prisma/client"); return { prisma: new PrismaClient({ datasourceUrl: `file:${state.path}` }) }; });
import { prisma } from "./prisma";
import { claimAgentFirstLaunch, recordFirstLaunchEvidence, finishAgentFirstLaunch } from "./agent-first-launch";
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
 const dep=await prisma.enrolledDeployment.create({data:{name:"app",slug:"app",kind:"compose",vpsConfigId:host.id,metadataJson:JSON.stringify({agentEnrollment:{recipeHash,firstLaunchState:"pending"}})}});deploymentId=dep.id;
 const grant=await prisma.oAuthGrant.create({data:{userId,clientDbId:client.id,scope:"deployment:redeploy",resources:JSON.stringify([deploymentId])}});grantId=grant.id;
 await prisma.agentDeploymentRecipe.create({data:{proposalId:input.proposalId,reviewId:"review_1",deploymentId,vpsConfigId:host.id,deploymentPath:prepared.plan.deploymentPath,userId,recipeJson,recipeHash}});
 const op={grantId,deploymentId,type:"deployment.first_launch",status:"running",inputJson:JSON.stringify({recipeHash})};
 operationId=(await prisma.agentOperation.create({data:{...op,idempotencyKey:"launch-first"}})).id;
 secondOperationId=(await prisma.agentOperation.create({data:{...op,idempotencyKey:"launch-second"}})).id;
});
afterAll(async()=>{vi.unstubAllEnvs();await prisma.$disconnect();rmSync(state.path,{force:true});});
const claim=(id=operationId)=>claimAgentFirstLaunch(deploymentId,id,recipeHash,grantId,userId);
it("permits only one launch even with different operation keys",async()=>{
 const results=await Promise.allSettled([claim(),claim(secondOperationId)]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect((await prisma.agentDeploymentRecipe.findUniqueOrThrow({where:{deploymentId}})).status).toBe("started");
 await expect(claim()).rejects.toThrow();
});
it("blocks a resource grant revoked before claim and before a later host phase",async()=>{
 await prisma.oAuthGrant.update({where:{id:grantId},data:{resources:"[]"}});await expect(claim()).rejects.toThrow(/authorized/);
 await prisma.oAuthGrant.update({where:{id:grantId},data:{resources:JSON.stringify([deploymentId])}});await claim();
 await prisma.oAuthGrant.update({where:{id:grantId},data:{revokedAt:new Date()}});
 await expect(recordFirstLaunchEvidence(deploymentId,operationId,grantId,userId,{phase:"launch"})).rejects.toThrow(/authorized/);
});
it("rejects changed host and recipe bytes before claim",async()=>{
 await prisma.vpsConfig.updateMany({data:{host:"192.0.2.2"}});await expect(claim()).rejects.toThrow(/host/);
 await prisma.vpsConfig.updateMany({data:{host:"192.0.2.1"}});
 await prisma.agentDeploymentRecipe.update({where:{deploymentId},data:{recipeJson:"{}"}});await expect(claim()).rejects.toThrow(/changed/);
});
it("records successful launch paths but never permits relaunch",async()=>{
 await claim();await finishAgentFirstLaunch(deploymentId,operationId,{success:true,status:"success",hostMutation:"confirmed",phase:"verified",deploymentPath:prepared.plan.deploymentPath,composePath:prepared.composePath,composeProject:prepared.composeProject,commitSha:"a".repeat(40),loopbackVerified:true,publicVerified:false});
 expect((await prisma.enrolledDeployment.findUniqueOrThrow({where:{id:deploymentId}})).composePath).toBe(prepared.composePath);
 await expect(claim(secondOperationId)).rejects.toThrow(/already claimed/);
});
it.each(["failed", "uncertain"] as const)("records truthful %s state and prevents replay",async status=>{
 await claim();await finishAgentFirstLaunch(deploymentId,operationId,{success:false,status,hostMutation:"possible",phase:"launch_started",deploymentPath:prepared.plan.deploymentPath,composePath:prepared.composePath,composeProject:prepared.composeProject,commitSha:"a".repeat(40),loopbackVerified:false,publicVerified:false});
 expect((await prisma.enrolledDeployment.findUniqueOrThrow({where:{id:deploymentId}})).status).toBe(status);
 expect((await prisma.agentDeploymentRecipe.findUniqueOrThrow({where:{deploymentId}})).status).toBe(status);
 await expect(claim(secondOperationId)).rejects.toThrow(/already claimed/);
});
