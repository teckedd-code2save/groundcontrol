import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import OnboardingClient from "./OnboardingClient";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/AmbientShader", () => ({ AmbientShader: () => null }));

let root: Root;
let container: HTMLDivElement;
const verify = vi.fn();
const probe = vi.fn();
const scan = {
  layout: { dockerAvailable: true, osName: "Alpine Linux", osFamily: "alpine" },
  containers: [{ name: "my-web-app", image: "example/web:1", status: "Up 2 minutes" }, { name: "my-database", image: "postgres:17" }],
  projects: [], reverseProxy: { type: "none" }, questions: [],
};
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/onboarding");
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  verify.mockResolvedValue(json({ verification: { ok: true, checks: {} } }));
  probe.mockResolvedValue(json(scan));
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/vps") return json([{ id: 1, name: "Local Docker workspace", isLocal: true, isActive: true }]);
    if (url === "/api/instance/publish" && options?.method === "POST") return verify(JSON.parse(String(options.body)));
    if (url === "/api/instance/publish") return json({ localDesktop: false, mode: "private" });
    if (url === "/api/onboarding/probe") return probe();
    throw new Error(`Unexpected request: ${url}`);
  }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function render(localDesktop = true) { await act(async () => root.render(<OnboardingClient localDesktop={localDesktop} />)); }
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  expect(button, `Missing button: ${label}`).toBeTruthy();
  await act(async () => button!.click());
}

it("checks the workspace and scans in one action, then shows actual apps without server jargon", async () => {
  await render();
  expect(container.textContent).toContain("Your workspace is ready");
  expect(container.textContent).not.toContain("Publish");
  await click("Scan my Docker apps");
  expect(verify).toHaveBeenCalledWith({ action: "verify" });
  expect(probe).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Found 2 running Docker containers");
  expect(container.textContent).toContain("my-web-app");
  for (const text of ["Alpine", "Caddy", "MCP", "**OS:**", "almost live", "scanned your server"]) expect(container.textContent).not.toContain(text);
  expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("Review");
  await click("Open dashboard");
  expect(push).toHaveBeenCalledWith("/dashboard");
});

it("does not scan after a failed check, and lets the operator retry", async () => {
  verify.mockResolvedValueOnce(json({ verification: { ok: false, checks: { container: { status: "failed", detail: "App is still starting." } } } }));
  await render();
  await click("Scan my Docker apps");
  expect(probe).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Make sure Docker is running");
  await click("Try again");
  expect(probe).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("You’re ready to explore");
});

it("shows a recoverable scan error rather than claiming the workspace is ready", async () => {
  probe.mockResolvedValueOnce(json({ error: "Unavailable" }, false));
  await render(); await click("Scan my Docker apps");
  expect(container.textContent).toContain("We couldn’t finish the scan");
  expect(container.textContent).not.toContain("Open dashboard");
  probe.mockResolvedValue(json({ ...scan, containers: [] }));
  await click("Try the scan again");
  expect(container.textContent).toContain("No running containers found yet");
});

it("retains server access choices for a server installation", async () => {
  await render(false);
  expect(container.textContent).toContain("Choose how you’ll open GroundControl");
  expect(container.textContent).toContain("I have a domain");
  expect(container.textContent).not.toContain("Scan my Docker apps");
});

it("retains explicit remote connection setup on a desktop installation", async () => {
  window.history.replaceState({}, "", "/onboarding?add=1");
  await render();
  expect(container.textContent).toContain("Add another server");
  expect(container.textContent).not.toContain("Scan my Docker apps");
});
