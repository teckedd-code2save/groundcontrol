import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AddressFirewallHelp, {type AddressFirewallAssistance} from "./AddressFirewallHelp";
let root: Root;
let container: HTMLDivElement;
const assistance: AddressFirewallAssistance = {provider: "azure", hostFirewalls: [{name: "ufw", state: "inactive", detail: "UFW is inactive"}, {name: "firewalld", state: "unavailable", detail: "Permission denied"}], hostGuidance: "Inspect existing rules first.", providerGuidance: "Review cloud rules."};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();});
async function render(value?: AddressFirewallAssistance) {await act(async () => root.render(<AddressFirewallHelp assistance={value} hostname="8.8.4.4.sslip.io" publicIpv4="8.8.4.4" />));}
async function copy() {await act(async () => container.querySelector("button")!.click());}
it("offers generic actionable guidance without requiring a cloud account", async () => {
  await render();
  expect(container.textContent).toContain("Not identified");
  expect(container.textContent).toContain("router/gateway");
  expect(container.textContent).not.toContain("Azure portal");
  expect(container.textContent).toContain("Nothing is sent, approved or changed here");
});
it("treats firewall observations as limited evidence and scopes Azure advice", async () => {
  await render(assistance);
  expect(container.textContent).toContain("Status not verified");
  expect(container.textContent).toContain("does not rule out nftables");
  expect(container.textContent).toContain("no provider firewall rules have been inspected");
  expect(container.textContent).toContain("both NIC and subnet");
  expect(container.textContent).toContain("private IPv4 /32, not its public IP");
  expect(container.textContent).toContain("Only after approval");
  expect(container.textContent).toContain("Do not widen a shared NSG");
});
it("copies a concrete review proposal, not permission or a mutation", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {clipboard: {writeText}});
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await render(assistance); await copy();
  const request = writeText.mock.calls[0][0];
  expect(request).toContain("8.8.4.4.sslip.io (public IPv4 8.8.4.4)");
  expect(request).toContain("This request is not approval to modify rules");
  expect(request).toContain("source/destination ranges, ports, rule priority and rollback");
  expect(request).toContain("Preserve existing SSH access");
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.textContent).toContain("No firewall change was approved or made");
});
it("lets users select another guide without connecting or changing anything", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await render();
  const select = container.querySelector("select")!;
  await act(async () => {select.value = "aws"; select.dispatchEvent(new Event("change", {bubbles: true}));});
  expect(container.textContent).toContain("EC2 → Instances");
  expect(container.textContent).not.toContain("Azure portal");
  expect(fetcher).not.toHaveBeenCalled();
});
it("provides selectable request text when clipboard is unavailable", async () => {
  vi.stubGlobal("navigator", {}); await render(); await copy();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Clipboard unavailable");
  const textarea = container.querySelector("textarea")!;
  expect(textarea.readOnly).toBe(true);
  expect(textarea.closest("details")?.open).toBe(true);
  expect(container.querySelector('[role="status"]')).toBeNull();
});
