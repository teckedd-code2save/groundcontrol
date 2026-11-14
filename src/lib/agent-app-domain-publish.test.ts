// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const network=vi.hoisted(()=>({ip:"52.1.2.3",status:200,marker:"",options:null as Record<string,unknown>|null}));
vi.mock("node:dns/promises",async()=>({...await vi.importActual("node:dns/promises"),resolve4:async()=>[network.ip],resolve6:async()=>[]}));
vi.mock("node:https",()=>({request:(options:Record<string,unknown>,callback:(response:unknown)=>void)=>{network.options=options;return{once:()=>{},destroy:()=>{},end:()=>queueMicrotask(()=>callback({statusCode:network.status,headers:{"x-groundcontrol-deployment":network.marker},destroy:()=>{}}))};}}));
const state=vi.hoisted(()=>({path:`/tmp/gc-app-domain-${process.pid}.db`}));
vi.mock("./prisma",async()=>{const {PrismaClient}=await import("@prisma/client");return{prisma:new PrismaClient({datasourceUrl:`file:${state.path}`})};});
import { prisma } from "./prisma";
import { reviewAgentAppDomain,publishAgentAppDomain,getAgentAppDomainPublication,getActiveAppDomainBinding,verifyActiveAppDomainBinding,appDomainPublishCommand,caddyHostnameCollision,type AppDomainDependencies } from "./agent-app-domain-publish";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
let userId:number,deploymentId:number,hostId:number;
const config={apps:{http:{servers:{srv0:{routes:[{match:[{host:["gc.example.com"]}]}]}}}}};
let activeConfig:unknown,txtVerified:boolean,publishOutput:string,publicIp:string;
const run=vi.fn();
const deps:AppDomainDependencies={run,dns4:(async()=>[publicIp]) as never,dns6:(async()=>[]) as never,tcp:async()=>true,txt:(async()=>txtVerified?[[(await prisma.agentAppDomainPublication.findFirstOrThrow()).challenge]]:[]) as never};
const body={hostname:"preview.example.com",hostnameApproved:true,idempotencyKey:"domain-review-1"};
beforeAll(()=>{execFileSync(process.execPath,["node_modules/prisma/build/index.js","db","push","--skip-generate"],{env:{...process.env,DATABASE_URL:`file:${state.path}`},stdio:"pipe"});},30000);
beforeEach(async()=>{
  vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS","1");txtVerified=true;publishOutput="domain-published\n";publicIp="52.1.2.3";activeConfig=config;run.mockReset();
  await prisma.agentAppDomainPublication.deleteMany();await prisma.agentDeploymentRecipe.deleteMany();await prisma.enrolledDeployment.deleteMany();await prisma.vpsConfig.deleteMany();await prisma.appConfig.deleteMany();await prisma.project.deleteMany();await prisma.user.deleteMany();
  userId=(await prisma.user.create({data:{username:"owner",password:"test"}})).id;
  const host=await prisma.vpsConfig.create({data:{host:"52.1.2.3",username:"azureuser"}});hostId=host.id;
  deploymentId=(await prisma.enrolledDeployment.create({data:{name:"app",slug:"app",kind:"compose",vpsConfigId:host.id,metadataJson:"{}"}})).id;
  const recipeJson=JSON.stringify({recipe:{proposalId:"proposal123",health:{service:"web",port:8080,path:"/api/health"}}});
  await prisma.agentDeploymentRecipe.create({data:{proposalId:"proposal123",reviewId:"review123",deploymentId,vpsConfigId:host.id,deploymentPath:"/srv/gc-test",userId,recipeJson,recipeHash:hash(recipeJson),status:"success"}});
  await prisma.appConfig.create({data:{key:"groundcontrol_public_url",value:"https://gc.example.com"}});
  run.mockImplementation(async(command:string)=>{
    if(command.includes("timeout -k 5s 180s"))return{code:publishOutput.includes("domain-published")?0:1,stdout:publishOutput,stderr:""};
    if(command.includes("api.ipify.org"))return{code:0,stdout:publicIp,stderr:""};
    if(command.includes("caddyInstalled="))return{code:0,stdout:"caddyInstalled=1\nmanagedSitesImported=1\ncaddyConfigValid=1\nmanagedDirectoryWritable=1\n",stderr:""};
    if(command.includes("ss -H"))return{code:0,stdout:'LISTEN 0 4096 *:80 *:* users:(("caddy",pid=1,fd=1))\nLISTEN 0 4096 *:443 *:* users:(("caddy",pid=1,fd=2))',stderr:""};
    if(command.includes("caddy adapt"))return{code:0,stdout:JSON.stringify(config),stderr:""};
    if(command.includes("2019/config"))return{code:0,stdout:JSON.stringify(activeConfig),stderr:""};
    return{code:0,stdout:"b".repeat(64),stderr:""};
  });
});
afterAll(async()=>{vi.unstubAllEnvs();await prisma.$disconnect();rmSync(state.path,{force:true});});
const review=()=>reviewAgentAppDomain(userId,deploymentId,body,deps);
const publish=(r:{reviewId:string;planHash:string})=>publishAgentAppDomain(userId,deploymentId,{reviewId:r.reviewId,planHash:r.planHash},deps);
describe("owner-bound app publication",()=>{
  it("discovers preconditions without trusting supplied flags or changing remote state",async()=>{
    await expect(reviewAgentAppDomain(userId,deploymentId,{...body,ownershipVerified:true},deps)).rejects.toThrow();
    const r=await review();expect(r.plan.readyForPublishReview).toBe(true);
    expect(run.mock.calls.every(([, , ,stdin])=>stdin===undefined)).toBe(true);
    expect(run.mock.calls.some(([cmd])=>String(cmd).includes("timeout -k 5s 180s"))).toBe(false);
    expect(r.requiredTxt.name).toBe("_groundcontrol.preview.example.com");
  });
  it("allows DNS preparation before first launch but blocks publication",async()=>{
    await prisma.agentDeploymentRecipe.update({where:{deploymentId},data:{status:"pending"}});
    const r=await review();expect(r.plan.blockers.some((b:{field:string})=>b.field==="application")).toBe(true);
    await expect(publish(r)).rejects.toThrow(/successfully launched/);
  });
  it("refreshes missing TXT evidence on the same challenge",async()=>{
    txtVerified=false;const first=await review();expect(first.plan.readyForPublishReview).toBe(false);
    txtVerified=true;const next=await review();expect(next.requiredTxt).toEqual(first.requiredTxt);expect(next.plan.readyForPublishReview).toBe(true);
  });
  it("protects GC and production hostnames",async()=>{
    await prisma.project.create({data:{slug:"production",name:"Production",domain:"preview.example.com",path:"/opt/prod"}});
    const r=await review();expect(r.plan.blockers.some((b:{field:string})=>b.field==="hostname")).toBe(true);
    const gc=await reviewAgentAppDomain(userId,deploymentId,{...body,hostname:"gc.example.com",idempotencyKey:"gc-review-1"},deps);expect(gc.plan.readyForPublishReview).toBe(false);
  });
  it("blocks live Caddy differences even if only string whitespace changed",async()=>{
    activeConfig={...config,note:"a b"};const r=await review();expect(r.plan.blockers.some((b:{field:string})=>b.field==="caddyRuntimeConfig")).toBe(true);
  });
  it("pins the host and refuses stale application identity before writing",async()=>{
    const r=await review();await prisma.vpsConfig.update({where:{id:hostId},data:{host:"52.1.2.4"}});
    await expect(publish(r)).rejects.toThrow(/changed/);expect(run.mock.calls.some(([cmd])=>String(cmd).includes("timeout -k 5s 180s"))).toBe(false);
  });
  it("single-claims publication and sends config only through stdin",async()=>{
    const r=await review();const done=await publish(r);expect(done.status).toBe("success");
    const writes=run.mock.calls.filter(([cmd])=>String(cmd).includes("timeout -k 5s 180s"));expect(writes).toHaveLength(1);
    expect(writes[0][3]).toContain("reverse_proxy 127.0.0.1:8080");expect(writes[0][0]).not.toContain("header >X-GroundControl");
    expect((await publish(r)).status).toBe("success");expect(run.mock.calls.filter(([cmd])=>String(cmd).includes("timeout -k 5s 180s"))).toHaveLength(1);
    const dep=await prisma.enrolledDeployment.findUniqueOrThrow({where:{id:deploymentId}});expect(JSON.parse(dep.metadataJson!).manualPublicUrl).toBe("https://preview.example.com");
    expect((await prisma.appConfig.findUniqueOrThrow({where:{key:"groundcontrol_public_url"}})).value).toBe("https://gc.example.com");
    expect(done.result.independentExternalVerification).toBe(false);
    expect((await getActiveAppDomainBinding(userId,deploymentId))?.publicUrl).toBe("https://preview.example.com");
  });
  it("records exact rollback failure without updating public URL or replaying",async()=>{
    const r=await review();publishOutput="domain-failed:https-verification\ndomain-rolled-back\n";
    const done=await publish(r);expect(done.status).toBe("failed");expect(done.result.rolledBack).toBe(true);
    expect(JSON.parse((await prisma.enrolledDeployment.findUniqueOrThrow({where:{id:deploymentId}})).metadataJson!).manualPublicUrl).toBeUndefined();
    expect((await publish(r)).status).toBe("failed");
  });
  it("makes lost replies uncertain and never replays",async()=>{
    const r=await review();publishOutput="";expect((await publish(r)).status).toBe("uncertain");expect((await publish(r)).status).toBe("uncertain");
    expect(run.mock.calls.filter(([cmd])=>String(cmd).includes("timeout -k 5s 180s"))).toHaveLength(1);
  });
  it("expires an interrupted dispatch without attempting host recovery",async()=>{
    const r=await review();await prisma.agentAppDomainPublication.update({where:{id:r.reviewId},data:{status:"running",startedAt:new Date(0)}});
    const count=run.mock.calls.length;expect((await getAgentAppDomainPublication(userId,deploymentId,r.reviewId)).status).toBe("uncertain");expect(run.mock.calls).toHaveLength(count);
  });
  it("binds immutable destination and uses create-only route plus trusted TLS command",async()=>{
    const r=await review();const row=await prisma.agentAppDomainPublication.findUniqueOrThrow({where:{id:r.reviewId}});const envelope=JSON.parse(row.planJson);
    const command=appDomainPublishCommand(envelope);
    execFileSync("sh",["-n","-c",command]);
    expect(command).toContain("flock -n 9");expect(command).toContain('ln "$stage"');expect(command).toContain("--resolve");expect(command).toContain("/api/health");
    expect(command).not.toContain("curl -k");expect(command).not.toContain("systemctl restart");expect(command).not.toContain("groundcontrol.caddy");
    envelope.plan.hostname="production.example.com";expect(()=>appDomainPublishCommand(envelope)).toThrow(/changed/);
  });
  it("requires owner admin identity and isolates reviews",async()=>{
    const r=await review();await expect(getAgentAppDomainPublication(userId+1,deploymentId,r.reviewId)).rejects.toThrow();
    await prisma.user.update({where:{id:userId},data:{role:"viewer"}});await expect(publish(r)).rejects.toThrow(/administrator/);
  });
});
it("detects exact and wildcard Caddy hostname conflicts without false substring matches",()=>{
  expect(caddyHostnameCollision({match:[{host:["*.example.com"]}]},"preview.example.com")).toBe(true);
  expect(caddyHostnameCollision(config,"gc.example.com")).toBe(true);
  expect(caddyHostnameCollision(config,"other.example.com")).toBe(false);
});


it.each(["success","tls-failure","validation-failure","reload-failure","route-changed","invalid-symlink","invalid-directory"])("executes create-only publication/rollback shell safely: %s",async mode=>{
  const r=await review();const row=await prisma.agentAppDomainPublication.findUniqueOrThrow({where:{id:r.reviewId}});const envelope=JSON.parse(row.planJson);
  const root=mkdtempSync(join(tmpdir(),"gc-domain-shell-")),dir=join(root,"caddy"),bin=join(root,"bin"),site=join(dir,`sites/gc-app-${deploymentId}.caddy`);
  mkdirSync(join(dir,"sites"),{recursive:true});mkdirSync(bin);
  writeFileSync(join(dir,"Caddyfile"),`import ${dir}/sites/*\n`);writeFileSync(join(dir,"sites/production.caddy"),"production must stay\n");
  writeFileSync(join(dir,"active.json"),JSON.stringify(config));
  envelope.filesHash=execFileSync("sh",["-c",`for f in '${dir}/Caddyfile' '${dir}'/sites/*; do sha256sum "$f"; done | sha256sum | cut -d ' ' -f 1`],{encoding:"utf8"}).trim();
  const put=(name:string,source:string)=>writeFileSync(join(bin,name),`#!/bin/sh\n${source}\n`,{mode:0o755});
  put("caddy",`case "$1" in adapt) printf '%s' '${JSON.stringify(config)}';; validate) [ "$MODE" = validation-failure ] && [ -f "$SITE" ] && exit 1; exit 0;; reload) [ "$MODE" = reload-failure ] && [ -f "$SITE" ] && exit 1; printf reload >> "$DIR/reloads"; exit 0;; *) exit 1;; esac`);
  put("docker",`case "$1" in ps) printf abcdef123456;; inspect) printf '%s' '${envelope.target.composeProject}|web|true';; port) printf '%s' '4000/tcp -> 127.0.0.1:8080';; *) exit 1;; esac`);
  put("curl",`headers=''; last=''; while [ "$#" -gt 0 ]; do if [ "$1" = -D ]; then shift; headers=$1; fi; last=$1; shift; done
case "$last" in *2019/config/) cat "$DIR/active.json";; http://127.0.0.1:8080/*) printf 200;; https://*) if [ "$MODE" = tls-failure ]; then printf 000; exit 1; fi; if [ "$MODE" = route-changed ]; then printf unrelated > "$SITE"; printf 000; exit 1; fi; printf 'X-GroundControl-Deployment: %s\\r\\n' "$MARKER" > "$headers"; printf 200;; *) exit 1;; esac`);
  put("sleep","exit 0");
  if(mode==="invalid-symlink")symlinkSync(join(dir,"missing"),join(dir,"sites/zz-invalid"));
  if(mode==="invalid-directory")mkdirSync(join(dir,"sites/zz-invalid"));
  let stdout="",code=0;
  try{
    const command=appDomainPublishCommand(envelope).replaceAll("/etc/caddy",dir);
    stdout=execFileSync("sh",["-c",command],{input:envelope.config,encoding:"utf8",env:{...process.env,PATH:`${bin}:${process.env.PATH}`,MODE:mode,DIR:dir,SITE:site,MARKER:envelope.marker},timeout:10000});
  }catch(error){const failed=error as {status:number;stdout:Buffer|string};code=failed.status;stdout=String(failed.stdout);}
  try{
    expect(readFileSync(join(dir,"sites/production.caddy"),"utf8")).toBe("production must stay\n");
    if(mode==="success"){expect(code).toBe(0);expect(stdout).toContain("domain-published");expect(readFileSync(site,"utf8")).toBe(envelope.config);}
    else if(mode.startsWith("invalid-")){expect(code).not.toBe(0);expect(stdout).toContain("domain-not-applied:files-changed");expect(existsSync(site)).toBe(false);expect(existsSync(join(dir,"reloads"))).toBe(false);}
    else if(mode==="route-changed"){expect(code).not.toBe(0);expect(stdout).toContain("domain-uncertain:route-changed");expect(readFileSync(site,"utf8")).toBe("unrelated");}
    else{expect(code).not.toBe(0);expect(stdout).toContain("domain-rolled-back");expect(existsSync(site)).toBe(false);}
  }finally{rmSync(root,{recursive:true,force:true});}
});

it("verifies updates against persisted binding, direct DNS and trusted pinned HTTPS marker",async()=>{
  const r=await review();await publish(r);const binding=(await getActiveAppDomainBinding(userId,deploymentId))!;
  network.ip=binding.publicIpv4;network.status=200;network.marker=binding.marker;
  expect((await verifyActiveAppDomainBinding(userId,deploymentId,binding)).healthy).toBe(true);
  expect(network.options).toMatchObject({hostname:"preview.example.com",servername:"preview.example.com",path:"/api/health",rejectUnauthorized:true,family:4});
  const lookup=network.options!.lookup as (name:string,opts:unknown,cb:(error:unknown,address:string,family:number)=>void)=>void;
  const callback=vi.fn();lookup("preview.example.com",{},callback);expect(callback).toHaveBeenCalledWith(null,"52.1.2.3",4);
  network.marker="wrong";expect((await verifyActiveAppDomainBinding(userId,deploymentId,binding)).healthy).toBe(false);
  network.marker=binding.marker;network.status=302;expect((await verifyActiveAppDomainBinding(userId,deploymentId,binding)).healthy).toBe(false);
  network.status=200;network.ip="52.1.2.4";expect((await verifyActiveAppDomainBinding(userId,deploymentId,binding)).healthy).toBe(false);
  expect((await verifyActiveAppDomainBinding(userId,deploymentId,{...binding,planHash:"changed"})).checked).toBe(false);
});

it("reports a missing import without falsely reporting Caddy uninstalled",async()=>{
  const original=run.getMockImplementation()!;run.mockImplementation(async(command:string,...args:unknown[])=>command.includes("caddyInstalled=")?{code:0,stdout:"caddyInstalled=1\nmanagedSitesImported=0\ncaddyConfigValid=1\nmanagedDirectoryWritable=1\n",stderr:""}:original(command,...args));
  const r=await review();expect(r.plan.blockers.some((b:{field:string})=>b.field==="managedSitesImported")).toBe(true);expect(r.plan.blockers.some((b:{field:string})=>b.field==="caddyInstalled")).toBe(false);
});
it("permits a reviewed first-listener attempt with honest network uncertainty",async()=>{
  const original=run.getMockImplementation()!;run.mockImplementation(async(command:string,...args:unknown[])=>command.includes("ss -H")?{code:0,stdout:"",stderr:""}:original(command,...args));
  const r=await reviewAgentAppDomain(userId,deploymentId,body,{...deps,tcp:async()=>false});
  expect(r.plan.readyForPublishReview).toBe(true);expect(r.plan.warnings).toHaveLength(2);expect(r.plan.warnings.join(" ")).toContain("No firewall rule will be changed");expect(r.plan.independentExternalVerification).toBe(false);
});
it("blocks another listener and a failed connection to an already-listening Caddy",async()=>{
  const first=await reviewAgentAppDomain(userId,deploymentId,body,{...deps,tcp:async()=>false});expect(first.plan.blockers.some((b:{field:string})=>b.field==="port443Reachable")).toBe(true);
  const original=run.getMockImplementation()!;run.mockImplementation(async(command:string,...args:unknown[])=>command.includes("ss -H")?{code:0,stdout:'LISTEN 0 4096 *:443 *:* users:(("nginx",pid=1,fd=1))',stderr:""}:original(command,...args));
  const second=await review();expect(second.plan.blockers.some((b:{field:string})=>b.field==="listener443")).toBe(true);
});


it.each(["symlink","directory"])("rejects invalid config entries during actual review fingerprint: %s",async kind=>{
  await review();
  const command=String(run.mock.calls.find(([cmd])=>String(cmd).includes("checks=$(for"))![0]);
  const root=mkdtempSync(join(tmpdir(),"gc-domain-fingerprint-")),dir=join(root,"caddy");
  mkdirSync(join(dir,"sites"),{recursive:true});
  writeFileSync(join(dir,"Caddyfile"),`import ${dir}/sites/*\n`);
  writeFileSync(join(dir,"sites/production.caddy"),"production must stay\n");
  try{
    const local=command.replaceAll("/etc/caddy",dir);
    expect(execFileSync("sh",["-c",local],{encoding:"utf8"}).trim()).toMatch(/^[a-f0-9]{64}$/);
    if(kind==="symlink")symlinkSync(join(dir,"missing"),join(dir,"sites/zz-invalid"));
    else mkdirSync(join(dir,"sites/zz-invalid"));
    try{execFileSync("sh",["-c",local],{encoding:"utf8"});throw new Error("invalid entry accepted");}
    catch(error){expect((error as {status:number}).status).not.toBe(0);expect((error as {stdout:string}).stdout).toBe("");}
  }finally{rmSync(root,{recursive:true,force:true});}
});
