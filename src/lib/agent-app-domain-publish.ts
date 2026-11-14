import { createHash, randomBytes } from "node:crypto";
import { resolve4, resolve6, resolveTxt } from "node:dns/promises";
import { createConnection } from "node:net";
import { request as httpsRequest } from "node:https";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { planAgentAppDomain, type AppDomainHostSnapshot, type AppDomainPreflight } from "./agent-app-domain";
import { normalizePublicHostname } from "./instance-publish";
import { execOnWorkloadTarget } from "./host-exec";
import { shQuote } from "./vps";
import { agentEnrollmentEnabled } from "./agent-enrollment";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
type Plan=ReturnType<typeof planAgentAppDomain>;
type Recipe={proposalId:string;health:{service:string;port:number;path:string}};
type Snapshot={recipeHash:string;health:Recipe["health"];composeProject:string;host:AppDomainHostSnapshot};
type Envelope={version:1;plan:Plan;target:Snapshot;config:string;configHash:string;marker:string;activeConfigHash:string;adaptedConfigHash:string;filesHash:string};
type Db=Prisma.TransactionClient;
export type AppDomainDependencies={run?:typeof execOnWorkloadTarget;dns4?:typeof resolve4;dns6?:typeof resolve6;txt?:typeof resolveTxt;tcp?:(ip:string,port:number)=>Promise<boolean>};
const snapshot=(host:{id:number;host:string;port:number;username:string;authType:string;isLocal:boolean;updatedAt:Date}):AppDomainHostSnapshot=>({id:host.id,host:host.host,port:host.port,username:host.username,authType:host.authType,isLocal:host.isLocal,updatedAt:host.updatedAt.toISOString()});
async function owner(userId:number,db:Pick<Db,"user">=prisma){
  if(!agentEnrollmentEnabled())throw new Error("Application publishing is not enabled.");
  const user=await db.user.findUnique({where:{id:userId}});
  if(!user||user.role!=="admin"||user.forcePasswordChange)throw new Error("A current administrator session is required.");
}
async function target(userId:number,deploymentId:number,db:Pick<Db,"user"|"agentDeploymentRecipe"|"enrolledDeployment">=prisma,requireSuccess=false){
  await owner(userId,db);
  if(!Number.isSafeInteger(deploymentId)||deploymentId<1)throw new Error("Invalid deployment.");
  const saved=await db.agentDeploymentRecipe.findUnique({where:{deploymentId}});
  const deployment=await db.enrolledDeployment.findUnique({where:{id:deploymentId},include:{vpsConfig:true}});
  if(!saved||saved.userId!==userId||(requireSuccess&&saved.status!=="success")||hash(saved.recipeJson)!==saved.recipeHash||!deployment?.vpsConfig||deployment.vpsConfigId!==saved.vpsConfigId)throw new Error("A successfully launched owner-approved application is required.");
  const recipe=JSON.parse(saved.recipeJson).recipe as Recipe;
  if(!recipe?.health||!Number.isSafeInteger(recipe.health.port)||recipe.health.port<1024||recipe.health.port>65535||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(recipe.health.service)||!/^\/[A-Za-z0-9/_.-]{0,199}$/.test(recipe.health.path))throw new Error("The approved health recipe is invalid.");
  const host=deployment.vpsConfig;
  return {deployment,launchStatus:saved.status,vps:{...host,privateKey:host.privateKey??undefined,password:host.password??undefined},snapshot:{recipeHash:saved.recipeHash,health:recipe.health,composeProject:`gcf_${hash(recipe.proposalId).slice(0,24)}`,host:snapshot(host)} satisfies Snapshot};
}
async function protectedHostnames(deploymentId:number){
  const [settings,projects,deployments]=await Promise.all([
    prisma.appConfig.findMany({where:{key:{in:["groundcontrol_public_url"]}}}),prisma.project.findMany({select:{domain:true}}),
    prisma.enrolledDeployment.findMany({where:{id:{not:deploymentId}},select:{metadataJson:true}}),
  ]);
  const names=new Set<string>();
  const add=(value:unknown)=>{if(typeof value!=="string"||!value)return;try{names.add(normalizePublicHostname(value.includes("://")?new URL(value).hostname:value));}catch{/* malformed recorded URLs cannot be used as routing authority */}};
  settings.forEach(row=>add(row.value));projects.forEach(row=>add(row.domain));
  deployments.forEach(row=>{try{const meta=JSON.parse(row.metadataJson||"{}");add(meta.manualPublicUrl);add(meta.publicUrl);}catch{}});
  return [...names].sort();
}
async function dnsValues<T>(read:()=>Promise<T>,absent:T):Promise<T|null>{try{return await read();}catch(error){return ["ENODATA","ENOTFOUND"].includes(String((error as {code?:string}).code))?absent:null;}}
async function reachable(ip:string,port:number){return new Promise<boolean>(resolve=>{const socket=createConnection({host:ip,port});let done=false;const finish=(value:boolean)=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.setTimeout(3000,()=>finish(false));socket.once("connect",()=>finish(true));socket.once("error",()=>finish(false));});}
export function caddyHostnameCollision(json:unknown,hostname:string):boolean{
  if(Array.isArray(json))return json.some(item=>caddyHostnameCollision(item,hostname));
  if(!json||typeof json!=="object")return false;
  const row=json as Record<string,unknown>;
  if(Array.isArray(row.host)&&row.host.some(value=>typeof value==="string"&&(value.toLowerCase()===hostname||(value.startsWith("*.")&&hostname.endsWith(value.slice(1).toLowerCase())))))return true;
  return Object.values(row).some(value=>caddyHostnameCollision(value,hostname));
}

const trimNl=(value:string)=>value.replace(/\n+$/,"");
function canonicalJson(value:unknown):string { if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;if(value&&typeof value==="object")return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;return JSON.stringify(value); }
function configFilesFingerprint(exclude="") { return `checks=$(for f in /etc/caddy/Caddyfile /etc/caddy/sites/* /etc/caddy/sites/.[!.]* /etc/caddy/sites/..?*; do [ "$f" = ${shQuote(exclude)} ] && continue; [ -e "$f" ] || { test ! -L "$f" || exit 1; continue; }; test -f "$f" && test ! -L "$f" || exit 1; sha256sum "$f" || exit 1; done) || exit 1; printf '%s\\n' "$checks" | sha256sum | cut -d ' ' -f 1`; }

async function observe(t:Awaited<ReturnType<typeof target>>,hostname:string,challenge:string,deps:AppDomainDependencies){
  const run=deps.run||execOnWorkloadTarget;
  const ip=await run("curl --noproxy '*' -fsS --max-time 8 https://api.ipify.org",t.vps,undefined,undefined,{timeout:10000});
  const publicIp=ip.code===0?ip.stdout.trim():"";
  // Validate before using observed address in sockets or later commands.
  planAgentAppDomain({deploymentId:t.deployment.id,host:t.snapshot.host,hostname,approvedLoopbackPort:t.snapshot.health.port,observedPublicIpv4:publicIp,hostnameApproved:true,protectedHostnames:[],preflight:{caddyInstalled:null,caddyConfigValid:null,managedSitesImported:null,managedDirectoryWritable:null,hostnameAvailable:null,ownershipVerified:null,port80Reachable:null,port443Reachable:null,dnsA:null,dnsAAAA:null}});
  const checks=await run([
    "command -v caddy >/dev/null 2>&1 && printf 'caddyInstalled=1\\n' || printf 'caddyInstalled=0\\n'",
    "caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && printf 'caddyConfigValid=1\\n' || printf 'caddyConfigValid=0\\n'",
    "if [ -f /etc/caddy/Caddyfile ] && [ ! -L /etc/caddy/Caddyfile ] && grep -Fxq 'import /etc/caddy/sites/*' /etc/caddy/Caddyfile; then printf 'managedSitesImported=1\\n'; else printf 'managedSitesImported=0\\n'; fi",
    "safe=1; for p in /etc /etc/caddy /etc/caddy/sites; do [ -d \"$p\" ] && [ ! -L \"$p\" ] || safe=0; done; if [ \"$safe\" = 1 ] && [ -w /etc/caddy/sites ]; then printf 'managedDirectoryWritable=1\\n'; else printf 'managedDirectoryWritable=0\\n'; fi",
    "for tool in flock sha256sum curl timeout mktemp tr grep cut docker ss; do command -v \"$tool\" >/dev/null 2>&1 || printf 'missingTool=%s\\n' \"$tool\"; done",
  ].join("\n"),t.vps,undefined,undefined,{timeout:15000});
  const flags=new Map(checks.stdout.trim().split(/\r?\n/).filter(line=>/^[A-Za-z]+=[01]$/.test(line)).map(line=>line.split("=") as [string,string]));
  const missingTools=checks.stdout.trim().split(/\r?\n/).filter(line=>/^missingTool=(flock|sha256sum|curl|timeout|mktemp|tr|grep|cut|docker|ss)$/.test(line)).map(line=>line.split("=")[1]);
  const check=await run("caddy adapt --config /etc/caddy/Caddyfile --pretty 2>/dev/null",t.vps,undefined,undefined,{timeout:15000});
  let config:unknown=null;try{if(check.code===0)config=JSON.parse(check.stdout);}catch{}
  const listeners=await run("ss -H -ltnp '( sport = :80 or sport = :443 )'",t.vps,undefined,undefined,{timeout:8000});
  const listener=(port:number)=>{if(listeners.code!==0)return "unknown";const rows=listeners.stdout.split(/\r?\n/).filter(line=>new RegExp(`:${port}\\s`).test(line));if(!rows.length)return "none";return rows.every(line=>/\(\("caddy"/.test(line))?"caddy":"other-or-unidentified";};
  const portListeners={80:listener(80),443:listener(443)};
  const live=await run("curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:2019/config/",t.vps,undefined,undefined,{timeout:8000});
  let liveConfig:unknown=null;try{if(live.code===0)liveConfig=JSON.parse(live.stdout);}catch{}
  const fingerprint=await run(["set -eu", "test $(grep -Ec '^[[:space:]]*import[[:space:]]' /etc/caddy/Caddyfile) -eq 1", "for f in /etc/caddy/sites/* /etc/caddy/sites/.[!.]* /etc/caddy/sites/..?*; do [ -e \"$f\" ] || continue; test -f \"$f\" && test ! -L \"$f\" || exit 1; if grep -Eq '^[[:space:]]*import[[:space:]]' \"$f\"; then exit 1; fi; done",configFilesFingerprint()].join("\n"),t.vps,undefined,undefined,{timeout:8000});
  const sameConfig=config!==null&&liveConfig!==null&&canonicalJson(config)===canonicalJson(liveConfig);
  const filesHash=fingerprint.code===0?fingerprint.stdout.trim():"";
  const [a,aaaa,txt,p80,p443]=await Promise.all([
    dnsValues(()=> (deps.dns4||resolve4)(hostname) as Promise<string[]>,[]),dnsValues(()=> (deps.dns6||resolve6)(hostname) as Promise<string[]>,[]),
    dnsValues(()=> (deps.txt||resolveTxt)(`_groundcontrol.${hostname}`),[]), (deps.tcp||reachable)(publicIp,80),(deps.tcp||reachable)(publicIp,443),
  ]);
  const preflight:AppDomainPreflight={caddyInstalled:flags.get("caddyInstalled")==="1",caddyConfigValid:flags.get("caddyConfigValid")==="1"&&sameConfig,managedSitesImported:flags.get("managedSitesImported")==="1"&&/^[a-f0-9]{64}$/.test(filesHash),managedDirectoryWritable:flags.get("managedDirectoryWritable")==="1",hostnameAvailable:config!==null&&!caddyHostnameCollision(config,hostname),ownershipVerified:txt!==null&&txt.some(parts=>parts.join("")===challenge),port80Reachable:p80,port443Reachable:p443,dnsA:a,dnsAAAA:aaaa};
  const plan=planAgentAppDomain({deploymentId:t.deployment.id,host:t.snapshot.host,hostname,approvedLoopbackPort:t.snapshot.health.port,observedPublicIpv4:publicIp,hostnameApproved:true,protectedHostnames:await protectedHostnames(t.deployment.id),preflight});
  const warnings:string[]=[];
  for(const port of [80,443] as const){
    const field=port===80?"port80Reachable":"port443Reachable";
    if(portListeners[port]==="none"){
      plan.blockers=plan.blockers.filter(item=>item.field!==field);
      warnings.push(`No local TCP ${port} listener exists yet. This publication may make Caddy listen on ${port}; inbound Azure/network access is not established by this check. No firewall rule will be changed. Verify from an external browser afterward.`);
    }else if(portListeners[port]!=="caddy")plan.blockers.push({field:`listener${port}`,message:`TCP ${port} is occupied by another or unidentified process, or listeners could not be inspected. Resolve proxy ownership before publishing; nothing is stopped automatically.`});
  }
  if(missingTools.length)plan.blockers.push({field:"tools",message:`Required host tools missing: ${missingTools.join(", ")}. Complete server tooling setup separately.`});
  plan.readyForPublishReview=plan.blockers.length===0;
  if(t.launchStatus!=="success"){plan.blockers.push({field:"application",message:"Prepare these DNS records now. Publish only after the application first launch and loopback health succeed."});plan.readyForPublishReview=false;}
  if(!sameConfig){plan.blockers.push({field:"caddyRuntimeConfig",message:"Active Caddy configuration must match the on-disk configuration. API-managed or unverifiable configuration is not supported by this publisher."});plan.readyForPublishReview=false;}
  return {plan:{...plan,warnings,verificationOrigin:"groundcontrol-control-plane",independentExternalVerification:false},adaptedConfigHash:config===null?"":hash(trimNl(check.stdout)),activeConfigHash:liveConfig===null?"":hash(trimNl(live.stdout)),filesHash};
}
const resultView=(row:{id:string;deploymentId:number;hostname:string;challenge:string;status:string;planJson:string;planHash:string;expiresAt:Date;resultJson:string|null;error:string|null})=>({reviewId:row.id,deploymentId:row.deploymentId,hostname:row.hostname,status:row.status,planHash:row.planHash,expiresAt:row.expiresAt.toISOString(),plan:JSON.parse(row.planJson).plan??null,requiredTxt:{name:`_groundcontrol.${row.hostname}`,value:row.challenge},result:row.resultJson?JSON.parse(row.resultJson):null,error:row.error,notice:"App publication only. Existing production routes and GroundControl identity are preserved; DNS and firewall changes are not performed."});
export async function reviewAgentAppDomain(userId:number,deploymentId:number,raw:unknown,deps:AppDomainDependencies={}){
  const body=raw as Record<string,unknown>;
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(key=>!["hostname","hostnameApproved","idempotencyKey"].includes(key))||typeof body.hostname!=="string"||/[\x00-\x1f\x7f]/.test(body.hostname)||body.hostnameApproved!==true||typeof body.idempotencyKey!=="string"||!/^[A-Za-z0-9_.:-]{8,160}$/.test(body.idempotencyKey))throw new Error("Explicit hostname approval and a safe idempotency key are required.");
  const hostname=normalizePublicHostname(body.hostname),t=await target(userId,deploymentId);
  let row=await prisma.agentAppDomainPublication.findUnique({where:{userId_idempotencyKey:{userId,idempotencyKey:body.idempotencyKey}}});
  if(row&&(row.deploymentId!==deploymentId||row.hostname!==hostname||row.vpsConfigId!==t.vps.id))throw new Error("Idempotency key belongs to a different domain or deployment.");
  if(row&&row.status!=="reviewed")return resultView(row);
  if(!row)row=await prisma.agentAppDomainPublication.create({data:{deploymentId,vpsConfigId:t.vps.id,userId,hostname,idempotencyKey:body.idempotencyKey,challenge:`gc-app-${randomBytes(24).toString("hex")}`,expiresAt:new Date(Date.now()+15*60*1000)}});
  const {plan,activeConfigHash,adaptedConfigHash,filesHash}=await observe(t,hostname,row.challenge,deps);
  // Deferred response header overwrites upstream marker: https://caddyserver.com/docs/caddyfile/directives/header
  const config=`${hostname} {\n  header >X-GroundControl-Deployment ${row.challenge}\n  reverse_proxy 127.0.0.1:${t.snapshot.health.port}\n}\n`;
  const envelope:Envelope={version:1,plan,target:t.snapshot,config,configHash:hash(config),marker:row.challenge,activeConfigHash,adaptedConfigHash,filesHash};
  const planJson=JSON.stringify(envelope),planHash=hash(planJson);
  const updated=await prisma.agentAppDomainPublication.updateMany({where:{id:row.id,status:"reviewed"},data:{planJson,planHash,expiresAt:new Date(Date.now()+15*60*1000)}});
  if(updated.count!==1)throw new Error("Publication state changed during review.");
  return resultView(await prisma.agentAppDomainPublication.findUniqueOrThrow({where:{id:row.id}}));
}

/** Fixed destination and content hash; stdin is only the reviewed Caddy file. */
export function appDomainPublishCommand(envelope:Envelope){
  const p=envelope.plan,t=envelope.target;
  if(hash(envelope.config)!==envelope.configHash||envelope.marker.length!==55||!/^gc-app-[a-f0-9]{48}$/.test(envelope.marker)||!/^\/[A-Za-z0-9/_.-]{0,199}$/.test(t.health.path))throw new Error("Domain publication envelope changed.");
  const expected=planAgentAppDomain({deploymentId:p.deploymentId,host:t.host,hostname:p.hostname,approvedLoopbackPort:t.health.port,observedPublicIpv4:p.observedPublicIpv4,hostnameApproved:true,protectedHostnames:[],preflight:{caddyInstalled:true,caddyConfigValid:true,managedSitesImported:true,managedDirectoryWritable:true,hostnameAvailable:true,ownershipVerified:true,port80Reachable:true,port443Reachable:true,dnsA:[p.observedPublicIpv4],dnsAAAA:[]}});
  if(p.planHash!==expected.planHash||p.sitePath!==expected.sitePath||p.upstream!==expected.upstream)throw new Error("Domain destination changed.");
  const site=shQuote(p.sitePath);
  const lines=[
    "set -eu", "umask 022", "created=0; completed=0; headers=''; stage=''; reloadAttempted=0; afterReloadHash=''",
    "rollback() {",
    "  test \"$created\" = 1 || return 0",
    `  if [ -L ${site} ] || [ ! -f ${site} ] || [ "$(sha256sum ${site} | cut -d ' ' -f 1)" != ${shQuote(envelope.configHash)} ]; then printf 'domain-uncertain:route-changed\\n'; return 1; fi`,
    `  test "$(${configFilesFingerprint(p.sitePath)})" = ${shQuote(envelope.filesHash)} || { printf 'domain-uncertain:other-config-changed\\n'; return 1; }`,
    `  if [ "$reloadAttempted" = 1 ]; then liveNow=$(curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:2019/config/) || { printf 'domain-uncertain:active-unreadable\\n'; return 1; }; liveHash=$(printf %s "$liveNow" | sha256sum | cut -d ' ' -f 1); expectedLive=\"$afterReloadHash\"; [ -n "$expectedLive" ] || expectedLive=${shQuote(envelope.activeConfigHash)}; test "$liveHash" = "$expectedLive" || { printf 'domain-uncertain:active-changed\\n'; return 1; }; fi`,
    `  rm ${site} || { printf 'domain-uncertain:rollback-remove\\n'; return 1; }`,
    "  if [ \"$reloadAttempted\" = 1 ]; then caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { printf 'domain-uncertain:rollback-reload\\n'; return 1; }; fi",
    "  printf 'domain-rolled-back\\n'",
    "}",
    "finish() { code=$?; trap - EXIT; if [ \"$completed\" != 1 ]; then rollback || code=2; fi; if [ -n \"$headers\" ]; then rm -f \"$headers\"; fi; if [ -n \"$stage\" ]; then rm -f \"$stage\"; fi; exit \"$code\"; }",
    "trap finish EXIT", "trap 'exit 1' HUP INT TERM",
    "for p in /etc /etc/caddy /etc/caddy/sites; do test -d \"$p\" && test ! -L \"$p\" || exit 1; done",
    "test ! -L /etc/caddy/.groundcontrol-app.lock", "exec 9>>/etc/caddy/.groundcontrol-app.lock", "flock -n 9 || { printf 'domain-not-applied:lock-busy\\n'; exit 1; }",
    "test -f /etc/caddy/Caddyfile && test ! -L /etc/caddy/Caddyfile",
    "grep -Fxq 'import /etc/caddy/sites/*' /etc/caddy/Caddyfile",
    `test ! -e ${site} && test ! -L ${site} || { printf 'domain-not-applied:route-exists\\n'; exit 1; }`,
    // Re-read the active config under the lock. Exact and wildcard conflicts were checked during preflight;
    // fail if any byte changed between that preflight and this dispatch.
    `adapted=$(caddy adapt --config /etc/caddy/Caddyfile --pretty 2>/dev/null); test "$(printf %s "$adapted" | sha256sum | cut -d ' ' -f 1)" = ${shQuote(envelope.adaptedConfigHash)} || { printf 'domain-not-applied:configuration-changed\\n'; exit 1; }`,
    `live=$(curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:2019/config/); test "$(printf %s "$live" | sha256sum | cut -d ' ' -f 1)" = ${shQuote(envelope.activeConfigHash)} || { printf 'domain-not-applied:active-configuration-changed\\n'; exit 1; }`,
    `test "$(${configFilesFingerprint()})" = ${shQuote(envelope.filesHash)} || { printf 'domain-not-applied:files-changed\\n'; exit 1; }`,
    `ids=$(docker ps -q --filter ${shQuote(`label=com.docker.compose.project=${t.composeProject}`)} --filter ${shQuote(`label=com.docker.compose.service=${t.health.service}`)})`,
    "case \"$ids\" in ''|*[!a-f0-9]*) printf 'domain-not-applied:application-unverified\\n'; exit 1;; esac",
    `test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Running}}' "$ids")" = ${shQuote(`${t.composeProject}|${t.health.service}|true`)} || exit 1`,
    `docker port "$ids" | grep -Eq ${shQuote(`^[0-9]+/tcp -> 127[.]0[.]0[.]1:${t.health.port}$`)} || { printf 'domain-not-applied:port-unverified\\n'; exit 1; }`,
    `code=$(curl --noproxy '*' -sS -o /dev/null --max-time 10 -w '%{http_code}' ${shQuote(`http://127.0.0.1:${t.health.port}${t.health.path}`)})`,
    "case \"$code\" in 2[0-9][0-9]) ;; *) printf 'domain-not-applied:health-failed\\n'; exit 1;; esac",
    // Noclobber ensures this never replaces an existing production route.
    "stage=$(mktemp /etc/caddy/.gc-app-stage.XXXXXX)",
    "cat > \"$stage\"",
    `test "$(sha256sum "$stage" | cut -d ' ' -f 1)" = ${shQuote(envelope.configHash)}`,
    "chmod 644 \"$stage\"",
    `ln "$stage" ${site}; created=1`,
    "rm \"$stage\"; stage=''",
    `test "$(sha256sum ${site} | cut -d ' ' -f 1)" = ${shQuote(envelope.configHash)}`,
    "caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { printf 'domain-failed:validation\\n'; exit 1; }",
    `test "$(${configFilesFingerprint(p.sitePath)})" = ${shQuote(envelope.filesHash)} || { printf 'domain-failed:other-files-changed\\n'; exit 1; }`,
    `live=$(curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:2019/config/); test "$(printf %s "$live" | sha256sum | cut -d ' ' -f 1)" = ${shQuote(envelope.activeConfigHash)} || { printf 'domain-failed:active-configuration-changed\\n'; exit 1; }`,
    "reloadAttempted=1",
    "caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { printf 'domain-failed:reload\\n'; exit 1; }",
    "afterReload=$(curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:2019/config/); afterReloadHash=$(printf %s \"$afterReload\" | sha256sum | cut -d ' ' -f 1)",
    "headers=$(mktemp /etc/caddy/.gc-app-headers.XXXXXX)",
    // Verify trusted TLS with hostname/SNI while pinning the independently observed target IP.
    "verified=0; count=0; while [ \"$count\" -lt 12 ]; do count=$((count + 1));",
    `  code=$(curl --noproxy '*' --resolve ${shQuote(`${p.hostname}:443:${p.observedPublicIpv4}`)} -sS -D "$headers" -o /dev/null --max-time 8 -w '%{http_code}' ${shQuote(`https://${p.hostname}${t.health.path}`)} 2>/dev/null) || code=000`,
    `  case "$code" in 2[0-9][0-9]) if tr -d '\r' < "$headers" | grep -Fxiq ${shQuote(`X-GroundControl-Deployment: ${envelope.marker}`)}; then verified=1; break; fi;; esac`,
    "  sleep 3", "done",
    "test \"$verified\" = 1 || { printf 'domain-failed:https-verification\\n'; exit 1; }",
    "completed=1; printf 'domain-published\\n'",
  ];
  return `timeout -k 5s 180s sh -c ${shQuote(lines.join("\n"))}`;
}

export async function publishAgentAppDomain(userId:number,deploymentId:number,raw:unknown,deps:AppDomainDependencies={}){
  const body=raw as Record<string,unknown>;
  if(!body||typeof body!=="object"||Object.keys(body).some(key=>!["reviewId","planHash"].includes(key))||typeof body.reviewId!=="string"||body.reviewId.length>128||typeof body.planHash!=="string"||!/^[a-f0-9]{64}$/.test(body.planHash))throw new Error("Explicit reviewed publication identity is required.");
  const t=await target(userId,deploymentId,prisma,true);
  const row=await prisma.agentAppDomainPublication.findFirst({where:{id:body.reviewId,userId,deploymentId}});
  if(!row||row.planHash!==body.planHash||hash(row.planJson)!==row.planHash)throw new Error("Publication review changed or was not found.");
  if(row.status!=="reviewed")return resultView(row); // Never replay an attempted publication.
  const envelope=JSON.parse(row.planJson) as Envelope;
  if(row.expiresAt<=new Date()||!envelope.plan.readyForPublishReview||JSON.stringify(envelope.target)!==JSON.stringify(t.snapshot))throw new Error("Publication review expired or the approved host/application changed. Review again.");
  const observed=await observe(t,row.hostname,row.challenge,deps);
  if(!observed.plan.readyForPublishReview||observed.plan.planHash!==envelope.plan.planHash||observed.activeConfigHash!==envelope.activeConfigHash||observed.adaptedConfigHash!==envelope.adaptedConfigHash||observed.filesHash!==envelope.filesHash)throw new Error("Domain prerequisites changed. Review again before publishing.");
  const claimed=await prisma.$transaction(async tx=>{
    const current=await target(userId,deploymentId,tx,true);
    if(JSON.stringify(current.snapshot)!==JSON.stringify(envelope.target))throw new Error("Approved host/application changed before publication.");
    return tx.agentAppDomainPublication.updateMany({where:{id:row.id,status:"reviewed",planHash:row.planHash,expiresAt:{gt:new Date()}},data:{status:"running",startedAt:new Date(),error:null}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  if(claimed.count!==1)return resultView(await prisma.agentAppDomainPublication.findUniqueOrThrow({where:{id:row.id}}));
  let status="uncertain",error:string|null="Publication outcome could not be confirmed. Inspect the exact managed route; this operation will not replay.",result:Record<string,unknown>={publicUrl:envelope.plan.publicUrl};
  try{
    const response=await (deps.run||execOnWorkloadTarget)(appDomainPublishCommand(envelope),t.vps,undefined,envelope.config,{timeout:190000});
    const lines=response.stdout.trim().split(/\r?\n/);
    if(response.code===0&&lines.includes("domain-published")){status="success";error=null;result={publicUrl:envelope.plan.publicUrl,httpsVerified:true,applicationVerified:true,routeMarkerVerified:true,verificationOrigin:"deployment-host",independentExternalVerification:false};}
    else if(lines.some(line=>line.startsWith("domain-uncertain:"))){status="uncertain";}
    else if(lines.includes("domain-rolled-back")){status="failed";error="Publication verification failed. This operation's route was removed and Caddy reloaded; existing routes were preserved.";result={...result,rolledBack:true};}
    else if(lines.some(line=>line.startsWith("domain-not-applied:"))){status="failed";error="Publication preconditions changed before any route was written. Review the server, route and application health.";result={...result,applied:false};}
  }catch{/* Lost execution replies are deliberately uncertain; no remote retry or cleanup guess. */}
  await prisma.$transaction(async tx=>{
    await tx.agentAppDomainPublication.update({where:{id:row.id},data:{status,resultJson:JSON.stringify(result),error,finishedAt:new Date()}});
    if(status==="success"){
      const dep=await tx.enrolledDeployment.findUniqueOrThrow({where:{id:deploymentId}});
      let metadata:Record<string,unknown>={};try{metadata=JSON.parse(dep.metadataJson||"{}");}catch{}
      await tx.enrolledDeployment.update({where:{id:deploymentId},data:{metadataJson:JSON.stringify({...metadata,manualPublicUrl:envelope.plan.publicUrl,appDomainPublication:{id:row.id,planHash:row.planHash}})}});
    }
  });
  return resultView(await prisma.agentAppDomainPublication.findUniqueOrThrow({where:{id:row.id}}));
}
export async function getAgentAppDomainPublication(userId:number,deploymentId:number,reviewId:string){
  await owner(userId);
  const row=await prisma.agentAppDomainPublication.findFirst({where:{id:reviewId,userId,deploymentId}});
  if(!row)throw new Error("Publication not found.");
  // A stopped worker cannot turn a recorded dispatch into a fresh attempt.
  if(row.status==="running"&&row.startedAt&&row.startedAt.getTime()<Date.now()-5*60*1000){
    await prisma.agentAppDomainPublication.updateMany({where:{id:row.id,status:"running"},data:{status:"uncertain",error:"Publication was interrupted or lost its result. Inspect before recovery; automatic replay is prohibited."}});
    return resultView(await prisma.agentAppDomainPublication.findUniqueOrThrow({where:{id:row.id}}));
  }
  return resultView(row);
}

export interface ActiveAppDomainBinding { publicationId:string;planHash:string;publicUrl:string;hostname:string;publicIpv4:string;marker:string;host:AppDomainHostSnapshot;healthPath:string }
export async function getActiveAppDomainBinding(userId:number,deploymentId:number):Promise<ActiveAppDomainBinding|null>{
  await owner(userId);
  const row=await prisma.agentAppDomainPublication.findFirst({where:{userId,deploymentId,status:"success"},orderBy:{createdAt:"desc"}});
  if(!row)return null;
  if(hash(row.planJson)!==row.planHash)throw new Error("Application domain record changed.");
  const envelope=JSON.parse(row.planJson) as Envelope;
  const deployment=await prisma.enrolledDeployment.findUnique({where:{id:deploymentId},include:{vpsConfig:true}});
  if(!deployment?.vpsConfig||JSON.stringify(snapshot(deployment.vpsConfig))!==JSON.stringify(envelope.target.host))throw new Error("Application domain host changed; review its public access again.");
  return {publicationId:row.id,planHash:row.planHash,publicUrl:envelope.plan.publicUrl,hostname:row.hostname,publicIpv4:envelope.plan.observedPublicIpv4,marker:envelope.marker,host:envelope.target.host,healthPath:envelope.target.health.path};
}
/** Trusted TLS, exact hostname/SNI and pinned public destination, no redirects or response body retention. */
export async function verifyActiveAppDomainBinding(userId:number,deploymentId:number,expected:ActiveAppDomainBinding){
  const current=await getActiveAppDomainBinding(userId,deploymentId);
  if(!current||JSON.stringify(current)!==JSON.stringify(expected))return {checked:false,healthy:false,reason:"Application domain binding changed."};
  const [a,aaaa]=await Promise.all([dnsValues(()=>resolve4(current.hostname),[]),dnsValues(()=>resolve6(current.hostname),[])]);
  if(!a?.length||a.some(ip=>ip!==current.publicIpv4)||aaaa===null||aaaa.length)return {checked:true,healthy:false,reason:"Public DNS no longer matches the approved direct route."};
  const healthy=await new Promise<boolean>(resolve=>{
    let done=false;
    const finish=(value:boolean)=>{if(done)return;done=true;clearTimeout(timer);request.destroy();resolve(value);};
    const request=httpsRequest({hostname:current.hostname,servername:current.hostname,port:443,path:current.healthPath,method:"GET",rejectUnauthorized:true,family:4,lookup:(_name,_opts,callback)=>callback(null,current.publicIpv4,4)},response=>{
      const marker=response.headers["x-groundcontrol-deployment"];
      const valid=Boolean(response.statusCode&&response.statusCode>=200&&response.statusCode<300&&marker===current.marker);
      response.destroy();finish(valid);
    });
    const timer=setTimeout(()=>finish(false),15000);
    request.once("error",()=>finish(false));request.end();
  });
  return {checked:true,healthy,...(!healthy?{reason:"Trusted HTTPS, application health or route marker verification failed."}:{}),verificationOrigin:"groundcontrol-control-plane"};
}
