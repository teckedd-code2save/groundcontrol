// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const probe = vi.hoisted(() => vi.fn());
vi.mock("./caddy-address-preflight", () => ({execReadOnlyAddressProbe: probe}));
import { inspectAddressFirewallAssistance } from "./address-firewall-assistance";
beforeEach(() => { probe.mockReset(); probe.mockResolvedValue({code: 127, stdout: "", stderr: ""}); });
it("reports Azure and active UFW without claiming effective cloud access", async () => {
  probe.mockImplementation(async command => ({code: 0, stdout: command.includes("cloud-id") ? "azure" : command.includes("ufw status") ? "Status: active\nDefault: deny (incoming)" : "not running", stderr: ""}));
  const result = await inspectAddressFirewallAssistance();
  expect(result.provider).toBe("azure");
  expect(result.hostFirewalls[0].state).toBe("active");
  expect(result.providerGuidance).toContain("both the network-interface and subnet");
  expect(result.providerGuidance).toContain("not inspected or changed Azure rules");
  expect(result.hostGuidance).toContain("Preserve your existing SSH access rule");
  expect(JSON.stringify(result)).not.toContain("Default: deny");
});
it("does not confuse inactive firewall with public reachability", async () => {
  probe.mockImplementation(async command => ({code: 0, stdout: command.includes("ufw status") ? "Status: inactive" : command.includes("--state") ? "running" : "aws", stderr: ""}));
  const result = await inspectAddressFirewallAssistance();
  expect(result.hostFirewalls.map(item => item.state)).toEqual(["inactive", "active"]);
  expect(result.hostFirewalls[0].detail).toContain("other host or cloud filters");
  expect(result.provider).toBe("aws");
});
it("keeps missing tools, denial and timeouts unknown without leaking output", async () => {
  probe.mockRejectedValue(new Error("secret diagnostic"));
  const result = await inspectAddressFirewallAssistance();
  expect(result.provider).toBe("unknown");
  expect(result.hostFirewalls.every(item => item.state === "unavailable")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("secret diagnostic");
});
it("does not infer Azure from generic Hyper-V DMI", async () => {
  probe.mockResolvedValue({code: 0, stdout: "Microsoft Corporation\nVirtual Machine", stderr: ""});
  expect((await inspectAddressFirewallAssistance()).provider).toBe("unknown");
});
it("dispatches only bounded status reads, no credentials or mutation", async () => {
  await inspectAddressFirewallAssistance();
  expect(probe).toHaveBeenCalledTimes(3);
  for (const [command, timeout] of probe.mock.calls) {
    expect(timeout).toBe(5000);
    expect(command).not.toMatch(/169\.254|metadata|token|sudo|--add|ufw allow|enable|disable/);
  }
});
it.each([
  ["gce", "gcp", "VPC ingress"],
  ["Google\nGoogle Compute Engine", "gcp", "VPC ingress"],
  ["Amazon EC2\nm6i.large", "aws", "security-group"],
  ["NoCloud", "unknown", "server provider"],
  ["Apple Inc.\nMac", "unknown", "server provider"],
])("handles provider-neutral host identity %s", async (identity, provider, handoff) => {
  probe.mockImplementation(async command => ({code: command.includes("cloud-id") ? 0 : 127, stdout: command.includes("cloud-id") ? identity : "", stderr: ""}));
  const result = await inspectAddressFirewallAssistance();
  expect(result.provider).toBe(provider);
  expect(result.providerGuidance).toContain(handoff);
});
