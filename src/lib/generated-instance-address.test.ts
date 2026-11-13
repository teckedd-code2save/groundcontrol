// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ ip: vi.fn(), dns: vi.fn(), exec: vi.fn() }));
vi.mock("./caddy-address-preflight", () => ({
  currentPublicIpv4: m.ip, verifyCaddyDns: m.dns,
  execReadOnlyAddressProbe: (command: string, timeout: number) => m.exec(command, {requireHost: true, timeout}),
  normalizePublicHostname: (value: string) => value.trim().toLowerCase(),
}));
vi.mock("./host-exec", () => ({execOnHost: m.exec}));
vi.mock("./address-firewall-assistance", () => ({inspectAddressFirewallAssistance: async () => ({provider: "unknown", hostFirewalls: [], hostGuidance: "Review host rules", providerGuidance: "Review provider rules"})}));
import { inspectGeneratedInstanceAddress, isPublicIpv4, inspectCaddyPortNeeds } from "./generated-instance-address";
beforeEach(() => {
  vi.resetAllMocks();
  m.ip.mockResolvedValue("8.8.8.8"); m.dns.mockResolvedValue(undefined);
  m.exec.mockResolvedValue({code: 0, stdout: "", stderr: ""});
});
it("builds a free IP-bound address with no provider or DNS mutation", async () => {
  const plan = await inspectGeneratedInstanceAddress();
  expect(plan.hostname).toBe("8.8.8.8.sslip.io"); expect(plan.source).toBe("sslip");
  expect(plan.canPublish).toBe(true);
  expect(plan.stability).toContain("not forever");
  expect(m.dns).toHaveBeenCalledWith("8.8.8.8.sslip.io", "8.8.8.8");
  expect(m.exec).toHaveBeenCalledOnce();
  expect(m.exec).toHaveBeenCalledWith(expect.stringContaining("ss -H -ltnp"), {requireHost: true, timeout: 10000});
  expect(plan.needs.find(n => n.code === "ports_unverified")?.blocking).toBe(false);
});
it("accepts an explicitly supplied provider hostname only after DNS check", async () => {
  const plan = await inspectGeneratedInstanceAddress({providerHostname: " HOST.REGION.CLOUDAPP.AZURE.COM "});
  expect(plan.hostname).toBe("host.region.cloudapp.azure.com");
  expect(plan.source).toBe("provider");
  expect(m.dns).toHaveBeenCalledWith(plan.hostname, "8.8.8.8");
});
it("does not silently fallback when supplied provider hostname fails verification", async () => {
  m.dns.mockRejectedValue(new Error("DNS unavailable"));
  await expect(inspectGeneratedInstanceAddress({providerHostname: "server.example.com"})).rejects.toThrow("DNS unavailable");
  expect(m.exec).not.toHaveBeenCalled();
});
it.each(["0.0.0.0", "10.0.0.2", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "bad"])("rejects non-public IPv4 %s", async (ip) => {
  expect(isPublicIpv4(ip)).toBe(false); m.ip.mockResolvedValue(ip);
  await expect(inspectGeneratedInstanceAddress()).rejects.toThrow("globally routable");
  expect(m.dns).not.toHaveBeenCalled(); expect(m.exec).not.toHaveBeenCalled();
});
it("reuses known Caddy port ownership", async () => {
  m.exec.mockResolvedValue({code: 0, stdout: 'LISTEN 0 4096 *:443 *:* users:(("caddy",pid=123,fd=9))\nLISTEN 0 4096 [::]:80 [::]:* users:(("caddy",pid=123,fd=8))', stderr: ""});
  expect((await inspectGeneratedInstanceAddress()).canPublish).toBe(true);
});
it.each([
  'LISTEN 0 4096 *:443 *:* users:(("nginx",pid=123,fd=9))',
  'LISTEN 0 4096 *:80 *:*',
  'LISTEN 0 4096 *:80 *:* users:(("caddy",pid=123,fd=9),("nginx",pid=124,fd=8))',
])("preserves existing or unidentified proxies: %s", async (stdout) => {
  m.exec.mockResolvedValue({code: 0, stdout, stderr: ""});
  const plan = await inspectGeneratedInstanceAddress();
  expect(plan.canPublish).toBe(false);
  expect(plan.needs.some(n => n.code === "proxy_conflict" && n.blocking)).toBe(true);
  expect(m.exec).toHaveBeenCalledOnce();
});
it.each([{code: 127, stdout: "", stderr: "ss not found"}, {code: 0, stdout: "unrecognized output", stderr: ""}])("blocks unknown listener state", async (result) => {
  m.exec.mockResolvedValue(result);
  const plan = await inspectGeneratedInstanceAddress();
  expect(plan.canPublish).toBe(false);
  expect(plan.needs.some(n => n.code === "port_inspection_unavailable")).toBe(true);
});
it("ignores unrelated listeners without assuming external firewall readiness", async () => {
  m.exec.mockResolvedValue({code: 0, stdout: 'LISTEN 0 128 127.0.0.1:3003 *:* users:(("docker-proxy",pid=42,fd=1))', stderr: ""});
  const plan = await inspectGeneratedInstanceAddress();
  expect(plan.canPublish).toBe(true);
  expect(plan.needs.find(n => n.code === "ports_unverified")?.detail).toContain("cannot confirm outside reachability");
});

it("checks custom-domain port ownership without DNS or public IP discovery", async () => {
  m.exec.mockResolvedValue({code: 0, stdout: 'LISTEN 0 128 *:443 *:* users:(("nginx",pid=42,fd=1))', stderr: ""});
  expect(await inspectCaddyPortNeeds()).toEqual([expect.objectContaining({code: "proxy_conflict", blocking: true})]);
  expect(m.ip).not.toHaveBeenCalled(); expect(m.dns).not.toHaveBeenCalled();
});
