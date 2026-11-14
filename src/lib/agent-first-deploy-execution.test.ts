// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("./host-exec", () => ({ execOnWorkloadTarget: vi.fn() }));
vi.mock("./vps", () => ({ shQuote: (value: string) => `'${value.replace(/'/g, `'"'"'`)}'` }));
vi.mock("./agent-health", () => ({ probePublicUrl: vi.fn() }));
import { executeAgentFirstDeploy, executeAgentPublicSourceUpdate, prepareAgentPublicSourceUpdate, prepareFirstDeployExecution, type ApprovedFirstDeployRecipe } from "./agent-first-deploy-execution";
import { planAgentFirstDeploy } from "./agent-first-deploy-plan";
import type { VpsConnection } from "./vps";
function recipe(yaml = "services:\n  app:\n    build: .\n    ports: ['127.0.0.1:8080:80']\n"): ApprovedFirstDeployRecipe {
 const input = { proposalId: "proposal_12345", repositoryUrl: "https://github.com/example/app", commitSha: "a".repeat(40), composeFile: "compose.yml", composeYaml: yaml };
 return { ...input, recipeHash: planAgentFirstDeploy(input).recipeHash, health: { service: "app", port:8080,path:"/health" }, budget: { maxServices:2,cpusPerService:.5,memoryMbPerService:256,pidsPerService:64,timeoutSeconds:120 },allowUnboundedBuildResources:true };
}
const host = { id: 1 } as VpsConnection;
const ok = {code:0,stdout:"",stderr:""};
const ready = {...ok,stdout:"prerequisites-ready"};
const owned = () => ({...ok,stdout:`${prepareFirstDeployExecution(recipe()).composeProject}|app|true|{"80/tcp":[{"HostIp":"127.0.0.1","HostPort":"8080"}]}`});
describe("approved first deploy runner", () => {
 it("validates and imposes runtime resource limits", () => {
  const p = prepareFirstDeployExecution(recipe());
  expect(p.effectiveYaml).toContain("mem_limit: 256m"); expect(p.effectiveYaml).toContain("pids_limit: 64"); expect(p.effectiveYaml).toContain("restart: no");
 });
 it.each(["    network_mode: host", "    environment: {SECRET: abc}", "    ports: ['8080:80']", "    deploy: {replicas: 5}"])("rejects unsupported recipe %s", field => {
  expect(() => prepareFirstDeployExecution(recipe(`services:\n  app:\n    image: nginx\n${field}\n`))).toThrow();
 });
 it("rejects source changes, missing build acknowledgement and invalid budget", () => {
  expect(() => prepareFirstDeployExecution({...recipe(),recipeHash:"bad"})).toThrow();
  expect(() => prepareFirstDeployExecution({...recipe(),allowUnboundedBuildResources:false})).toThrow(/build/);
  const r = recipe(); r.budget.memoryMbPerService = 99999; expect(() => prepareFirstDeployExecution(r)).toThrow(/budget/);
 });
 it("runs pinned exclusive checkout and bounded launch only after durable evidence", async () => {
  const run = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(owned()).mockResolvedValueOnce({...ok,stdout:"verified"});
  const evidence = vi.fn().mockResolvedValue(undefined);
  const result = await executeAgentFirstDeploy(recipe(),host,evidence,{run});
  expect(result.success).toBe(true); expect(result.loopbackVerified).toBe(true); expect(result.publicVerified).toBe(false);
  const script = run.mock.calls.map(c => c[0]).join("\n");
  expect(script).not.toContain("rm -rf"); expect(script).toContain("fetch --depth 1"); expect(script).toContain("sha256sum"); expect(script).toContain("find . -type l"); expect(script).toContain("--env-file /dev/null"); expect(script).toContain("--wait"); expect(script).not.toContain("curl -k");
  expect(evidence.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
 });
 it("does not launch after collision/checksum/checkout failure", async () => {
  const run = vi.fn().mockResolvedValueOnce(ready).mockResolvedValue({...ok,code:1});
  expect((await executeAgentFirstDeploy(recipe(),host,async()=>{}, {run})).status).toBe("failed"); expect(run).toHaveBeenCalledTimes(2);
 });
 it("does not mutate when durable evidence cannot be saved", async () => {
  const run = vi.fn(); const result = await executeAgentFirstDeploy(recipe(),host,async()=>{throw Error("db");},{run});
  expect(result.status).toBe("uncertain"); expect(result.hostMutation).toBe("none"); expect(run).not.toHaveBeenCalled();
 });
 it("marks lost response/launch failure uncertain without retry", async () => {
  const run = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockRejectedValueOnce(Error("SSH lost"));
  expect((await executeAgentFirstDeploy(recipe(),host,async()=>{}, {run})).status).toBe("uncertain"); expect(run).toHaveBeenCalledTimes(4);
 });
 it("does not claim successful app without loopback verification", async () => {
  const run = vi.fn().mockResolvedValueOnce(ready).mockResolvedValue(ok);
  const result = await executeAgentFirstDeploy(recipe(),host,async()=>{}, {run}); expect(result.success).toBe(false); expect(result.loopbackVerified).toBe(false);
 });
 it.each(["missing-tool:git", "missing-tool:timeout", "missing-compose", "docker-unavailable", "unsafe-path", "unwritable-parent", "path-collision"])("preflight blocks without mutation: %s", async key => {
  const run = vi.fn().mockResolvedValue({...ok,code:1,stdout:key});
  const result = await executeAgentFirstDeploy(recipe(),host,async()=>{}, {run});
  expect(result.success).toBe(false); expect(result.error).toBeTruthy(); expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][0]).not.toContain("mkdir"); expect(run.mock.calls[0][0]).not.toContain("git fetch");
 });
 it("does not trust false preflight success or raw messages", async()=>{
  const run = vi.fn().mockResolvedValue({...ok,stdout:"private secret error"});
  const result = await executeAgentFirstDeploy(recipe(),host,async()=>{}, {run});
  expect(result.error).not.toContain("private secret"); expect(run).toHaveBeenCalledTimes(1);
 });
 it("rejects non-array ports actionably",()=>{
  expect(()=>prepareFirstDeployExecution(recipe("services:\n  app:\n    image: nginx\n    ports: 8080\n"))).toThrow(/explicit list/);
 });
 it.each(["other|app|true|{}", "wrong|app|false|{}", "invalid-json"])("does not probe unrelated endpoint when ownership invalid: %s", async stdout=>{
  const run = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce({...ok,stdout});
  const result = await executeAgentFirstDeploy(recipe(),host,async()=>{}, {run}); expect(result.success).toBe(false); expect(run).toHaveBeenCalledTimes(5);
 });
 it("uses a generated image name for builds instead of overwriting requested tags", ()=>{
  const result = prepareFirstDeployExecution(recipe("services:\n  app:\n    build: .\n    image: unrelated:latest\n    ports: ['127.0.0.1:8080:80']\n"));
  expect(result.effectiveYaml).not.toContain("unrelated:latest"); expect(result.effectiveYaml).toContain("gc-first-launch-");
 });
 it("assigns distinct tags to each built service",()=>{
  const p = prepareFirstDeployExecution(recipe("services:\n  app:\n    build: ./app\n    ports: ['127.0.0.1:8080:80']\n  worker:\n    build: ./worker\n"));
  const images = p.effectiveYaml.match(/image: (.+)/g); expect(images).toHaveLength(2); expect(images![0]).not.toBe(images![1]);
 });
 it("rejects oversized effective YAML before host actions",async()=>{
  const r = recipe(`services:\n  app:\n    image: nginx\n    ports: ['127.0.0.1:8080:80']\n    labels: {note: '${"x".repeat(33000)}'}\n`);
  const run=vi.fn(); await expect(executeAgentFirstDeploy(r,host,async()=>{}, {run})).rejects.toThrow(/32 KiB/); expect(run).not.toHaveBeenCalled();
 });
 it("retains confirmed host mutation when later config fails",async()=>{
  const run=vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(ok).mockResolvedValueOnce({...ok,code:1});
  const result=await executeAgentFirstDeploy(recipe(),host,async()=>{}, {run}); expect(result.success).toBe(false); expect(result.hostMutation).toBe("confirmed");
 });
 it("checkout timeout is uncertain, never a safe retry",async()=>{
  const run=vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce({...ok,code:124});
  expect((await executeAgentFirstDeploy(recipe(),host,async()=>{}, {run})).status).toBe("uncertain");
  expect(run.mock.calls[1][0]).toContain("timeout -k 5s");
 });
 it("public HTTPS must be separately verified", async () => {
  const run = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(owned()).mockResolvedValue({...ok,stdout:"verified"}); const publicProbe = vi.fn().mockResolvedValue({checked:true,healthy:false});
  const result = await executeAgentFirstDeploy({...recipe(),publicUrl:"https://app.example.test/health"},host,async()=>{}, {run,publicProbe});
  expect(result.loopbackVerified).toBe(true); expect(result.success).toBe(false); expect(publicProbe).toHaveBeenCalledOnce();
 });
});

describe("accepted public code-only source updates",()=>{
 const update = {deploymentId:7,operationId:"operation_12345",commitSha:"b".repeat(40)};
 it("preserves policy, project and named volumes while generating an exclusive release directory",()=>{
  const approved = recipe("services:\n  app:\n    build: .\n    ports: ['127.0.0.1:8080:80']\n    volumes: ['data:/data']\nvolumes:\n  data: {}\n");
  const before = JSON.stringify(approved);
  const original = prepareFirstDeployExecution(approved);
  const result = prepareAgentPublicSourceUpdate(approved,update);
  expect(result.prepared.composeProject).toBe(original.composeProject);
  expect(result.prepared.plan.deploymentPath).not.toBe(original.plan.deploymentPath);
  expect(result.prepared.plan.deploymentPath).toMatch(/\/release-[a-f0-9]{64}$/);
  expect(result.prepared.effectiveYaml).toContain("data:/data");
  expect(result.prepared.effectiveYaml).toContain(update.commitSha);
  expect(result.prepared.effectiveYaml).toContain(result.prepared.plan.deploymentPath);
  expect(result.recipe.composeYaml).toBe(approved.composeYaml);
  expect(result.recipe.budget).toEqual(approved.budget);
  expect(JSON.stringify(approved)).toBe(before);
  expect(prepareAgentPublicSourceUpdate(approved,{...update,operationId:"operation_other"}).prepared.plan.deploymentPath).not.toBe(result.prepared.plan.deploymentPath);
 });
 it.each(["main","v1.0","abc"])("rejects unpinned update %s",commitSha=>expect(()=>prepareAgentPublicSourceUpdate(recipe(),{...update,commitSha})).toThrow(/immutable/));
 it("rejects changed approved recipe instead of recomputing trust",()=>{
  const r=recipe(); r.composeYaml += "# changed";
  expect(()=>prepareAgentPublicSourceUpdate(r,update)).toThrow(/changed/);
 });
 it("checks new SHA and original Compose bytes before launch and keeps namespace",async()=>{
  const approved=recipe();
  const run=vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(owned()).mockResolvedValueOnce({...ok,stdout:"verified"});
  const result=await executeAgentPublicSourceUpdate(approved,update,host,async()=>{}, {run});
  expect(result.success).toBe(true); expect(result.commitSha).toBe(update.commitSha);
  expect(run.mock.calls[1][0]).toContain(update.commitSha); expect(run.mock.calls[1][0]).toContain("sha256sum");
  expect(result.composeProject).toBe(prepareFirstDeployExecution(approved).composeProject);
 });
 it("stops at checkout when new revision changes Compose",async()=>{
  const run=vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce({...ok,code:1});
  const result=await executeAgentPublicSourceUpdate(recipe(),update,host,async()=>{}, {run});
  expect(result.success).toBe(false); expect(run).toHaveBeenCalledTimes(2); expect(result.error).toContain("recipe verification");
 });
});

describe("private owner runtime configuration",()=>{
 function configured(){const r=recipe();r.configuration={version:1,projectId:1,profileId:2,bindings:[{service:"app",key:"API_KEY",required:true,versionId:3,version:1}]};return r;}
 function runner(secret="synthetic-$SECRET#'value") {return vi.fn().mockImplementation(async (command:string,...rest:unknown[])=> { void rest; return command.includes("printf prerequisites-ready")?ready:command.includes("docker inspect --format")?owned():command.includes("code=$(curl")?{...ok,stdout:"verified"}:command.includes("cat >")?{...ok,stderr:secret}:ok; });}
 it("uses private stdin and a directory outside every source build context",async()=>{
  const r=configured(),run=runner(), evidence=vi.fn();const secret="synthetic-$SECRET#'value";
  const result=await executeAgentFirstDeploy(r,host,evidence,{run,resolveRuntimeConfiguration:async()=>({app:{API_KEY:secret}})});
  expect(result.success).toBe(true);
  const calls=run.mock.calls;expect(calls.some(call=>call[3]===`API_KEY=${secret}\n`)).toBe(true);
  expect(calls.map(call=>call[0]).join("\n")).not.toContain(secret);
  expect(JSON.stringify(evidence.mock.calls)+JSON.stringify(result)).not.toContain(secret);
  const p=prepareFirstDeployExecution(r);expect(p.effectiveYaml).toContain(`${p.plan.deploymentPath}-runtime/.groundcontrol/env/app.env`);expect(p.effectiveYaml).toContain('format: raw');
 });
 it("accepts only approved environment key references",()=>{
  const r=configured();r.composeYaml="services:\n  app:\n    image: nginx\n    ports: ['127.0.0.1:8080:80']\n    environment:\n      API_KEY: ${API_KEY}\n";r.recipeHash=planAgentFirstDeploy(r).recipeHash;
  expect(prepareFirstDeployExecution(r).effectiveYaml).not.toContain('${API_KEY}');
  r.configuration=undefined;expect(()=>prepareFirstDeployExecution(r)).toThrow(/owner-approved/);
 });
 it.each([{app:{API_KEY:"x",EXTRA:"secret"}},{app:{API_KEY:"first\nsecond"}},{}])("rejects mismatched or multiline config without exposing values",async values=>{
  const run=runner();const result=await executeAgentFirstDeploy(configured(),host,async()=>{},{run,resolveRuntimeConfiguration:async()=>values as Record<string,Record<string,string>>});
  expect(result.success).toBe(false);expect(run.mock.calls.some(call=>call[0].includes(" up -d"))).toBe(false);
 });
 it("preserves private configuration injection on public source updates",async()=>{
  const run=runner(),r=configured();const input={deploymentId:1,operationId:"operation_config",commitSha:"b".repeat(40)};
  const p=prepareAgentPublicSourceUpdate(r,input).prepared;
  expect(p.effectiveYaml).toContain(`${p.plan.deploymentPath}-runtime/.groundcontrol/env/app.env`);
  const result=await executeAgentPublicSourceUpdate(r,input,host,async()=>{},{run,resolveRuntimeConfiguration:async()=>({app:{API_KEY:"secret"}})});
  expect(result.success).toBe(true);
 });
 it("never surfaces secret-bearing host errors",async()=>{
  const run=runner();run.mockImplementation(async(command:string)=>command.includes("printf prerequisites-ready")?ready:command.includes("cat >")?{...ok,code:1,stderr:"synthetic-secret"}:ok);
  const result=await executeAgentFirstDeploy(configured(),host,async()=>{},{run,resolveRuntimeConfiguration:async()=>({app:{API_KEY:"synthetic-secret"}})});
  expect(result.success).toBe(false);expect(JSON.stringify(result)).not.toContain("synthetic-secret");
 });
});
