// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planAgentAppDomain, APP_DOMAIN_PUBLISH_REQUIREMENTS, type AppDomainPlanInput } from "./agent-app-domain";
const fixture = (): AppDomainPlanInput => ({
  deploymentId:42,
  host:{id:3,host:"52.1.2.3",port:22,username:"azureuser",authType:"key",isLocal:false,updatedAt:"2026-11-14T03:00:00.000Z"},
  hostname:"preview.unstressed.example",approvedLoopbackPort:8080,observedPublicIpv4:"52.1.2.3",hostnameApproved:true,
  protectedHostnames:["gc.example.com","unstressed.example"],
  preflight:{caddyInstalled:true,caddyConfigValid:true,managedSitesImported:true,managedDirectoryWritable:true,hostnameAvailable:true,ownershipVerified:true,port80Reachable:true,port443Reachable:true,dnsA:["52.1.2.3"],dnsAAAA:[]},
});
describe("pure application domain plan", () => {
  it("renders a fixed loopback-only per-deployment route without changing GC identity", () => {
    const result = planAgentAppDomain(fixture());
    expect(result.readyForPublishReview).toBe(true);
    expect(result.sitePath).toBe("/etc/caddy/sites/gc-app-42.caddy");
    expect(result.config).toBe("preview.unstressed.example {\n  reverse_proxy 127.0.0.1:8080\n}\n");
    expect(result.requiredDns).toEqual({type:"A",name:"preview.unstressed.example",content:"52.1.2.3",mode:"direct"});
    expect(result.preservesGroundControlIdentity).toBe(true);
    expect(result.notice).toContain("Plan only");
    expect(result.planHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("normalizes DNS case and one trailing dot consistently", () => {
    const input=fixture(); input.hostname=" Preview.Unstressed.Example. ";
    expect(planAgentAppDomain(input).planHash).toBe(planAgentAppDomain(fixture()).planHash);
  });
  it.each(["127.0.0.1","[::1]","*.example.com","https://example.com","example.com:443","example.com/path","example.com\n}","example.com\t","x\u0000.example","localhost","a..example",`${"a".repeat(64)}.example`])("rejects non-hostname/injection input %j", value => {
    expect(()=>planAgentAppDomain({...fixture(),hostname:value})).toThrow();
  });
  it.each([0,1.5,-1,65536,Number.NaN])("rejects unsafe loopback port %s", port => {
    expect(()=>planAgentAppDomain({...fixture(),approvedLoopbackPort:port})).toThrow();
  });
  it.each(["127.0.0.1","10.0.0.1","169.254.169.254","100.64.0.1","172.16.0.1","192.168.0.1","0.0.0.0","224.0.0.1","::1","203.0.113.1"]) ("rejects non-public observed IPv4 %s", value=>{
    expect(()=>planAgentAppDomain({...fixture(),observedPublicIpv4:value})).toThrow();
  });
  it("binds identity/hash to all execution destinations and the host revision",()=>{
    const original=planAgentAppDomain(fixture()).planHash;
    for (const input of [
      {...fixture(),deploymentId:43}, {...fixture(),hostname:"different.example"}, {...fixture(),approvedLoopbackPort:8081},
      {...fixture(),host:{...fixture().host,id:4}}, {...fixture(),host:{...fixture().host,host:"52.1.2.4"}},
      {...fixture(),host:{...fixture().host,port:2222}}, {...fixture(),host:{...fixture().host,username:"different"}},
      {...fixture(),host:{...fixture().host,updatedAt:"2026-11-15T03:00:00.000Z"}},
    ]) expect(planAgentAppDomain(input).planHash).not.toBe(original);
  });
  it("blocks protected production and GC hostname reuse",()=>{
    for(const name of fixture().protectedHostnames) expect(planAgentAppDomain({...fixture(),hostname:name}).blockers.some(b=>b.field==="hostname")).toBe(true);
  });
  it("requires explicit hostname approval and trusted ownership evidence",()=>{
    const input=fixture(); input.hostnameApproved=false;input.preflight.ownershipVerified=null;
    expect(planAgentAppDomain(input).blockers.map(b=>b.field)).toEqual(["hostnameApproved","ownershipVerified"]);
  });
  it.each(["caddyInstalled","caddyConfigValid","managedSitesImported","managedDirectoryWritable","hostnameAvailable","port80Reachable","port443Reachable"] as const)("blocks absent/failed %s without offering automatic changes",key=>{
    for(const value of [false,null]) {
      const input=fixture();input.preflight[key]=value;
      expect(planAgentAppDomain(input).readyForPublishReview).toBe(false);
      expect(planAgentAppDomain(input).blockers.map(b=>b.field)).toContain(key);
    }
  });
  it("does not treat partial matching, proxied or unknown DNS as direct routing",()=>{
    for(const records of [null,[],["52.1.2.4"],["52.1.2.3","52.1.2.4"]]) {
      const input=fixture();input.preflight.dnsA=records;
      expect(planAgentAppDomain(input).blockers.map(b=>b.field)).toContain("dnsA");
    }
  });
  it("does not ignore unknown or stale AAAA records",()=>{
    for(const records of [null,["2001:db8::1"]]) {
      const input=fixture();input.preflight.dnsAAAA=records;
      expect(planAgentAppDomain(input).blockers.map(b=>b.field)).toContain("dnsAAAA");
    }
  });
  it("copies only safe host identity fields, never credentials",()=>{
    const input=fixture();Object.assign(input.host,{password:"private-value",privateKey:"private-key"});
    const output=JSON.stringify(planAgentAppDomain(input));
    expect(output).not.toContain("private-value"); expect(output).not.toContain("private-key");
  });
  it("rejects malformed host snapshots and preflight data",()=>{
    expect(()=>planAgentAppDomain({...fixture(),host:{...fixture().host,username:"root\nEOF"}})).toThrow();
    const input=fixture(); Object.assign(input.preflight,{port80Reachable:"yes"});expect(()=>planAgentAppDomain(input)).toThrow();
    const malformed=fixture();malformed.preflight.dnsA=["not-ip"];expect(()=>planAgentAppDomain(malformed)).toThrow();
  });
  it("records safe publisher requirements without executable commands",()=>{
    expect(APP_DOMAIN_PUBLISH_REQUIREMENTS.join(" ")).toContain("per-operation backup");
    expect(APP_DOMAIN_PUBLISH_REQUIREMENTS.join(" ")).toContain("Never disable TLS verification");
    expect(APP_DOMAIN_PUBLISH_REQUIREMENTS.join(" ")).toContain("GC issuer");
    expect(APP_DOMAIN_PUBLISH_REQUIREMENTS.join(" ")).not.toContain("curl -k");
  });
});
