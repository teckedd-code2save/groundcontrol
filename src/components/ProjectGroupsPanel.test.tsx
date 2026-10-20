import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectGroupsPanel } from "./ProjectGroupsPanel";
let root: Root; let container: HTMLDivElement;
const mutations: unknown[] = [];
beforeEach(() => {
  mutations.length = 0; vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("requestAnimationFrame", () => 0);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.body) mutations.push(JSON.parse(init.body));
    const data = url === "/api/deployment-inventory" ? { hostId: 3, candidates: [{ id: "compose:portal", name: "Portal web", kind: "compose", services: [] }, { id: "folder:/opt/code", name: "Code only", kind: "source" }] } : { hostId: 3, hostName: "Production server", localDesktop: false, projects: [{ id: 7, slug: "portal", name: "Portal", description: "Customer account portal", sources: [{ id: 1, path: "/opt/code", hostName: "Dev PC", technologies: ["JavaScript"] }], deployments: [] }], ungrouped: [] };
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(text: string) { const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text || item.textContent?.startsWith(text)); expect(button).toBeTruthy(); await act(async () => button!.click()); }
it("shows source independently from deployments and carries project, environment and host into launch", async () => {
  await act(async () => root.render(<ProjectGroupsPanel projectSlug="portal" />));
  expect(container.textContent).toContain("/opt/code"); expect(container.textContent).toContain("ready for its first deployment");
  await click("Add deployment"); await click("Launch a new deployment");
  const link = document.querySelector('[role="dialog"] a[href^="/templates"]');
  expect(link?.getAttribute("href")).toBe("/templates?projectId=7&environment=Production&hostId=3");
  expect(mutations).toEqual([]);
});
it("connects a running app to the chosen project and environment, excluding source-only folders", async () => {
  await act(async () => root.render(<ProjectGroupsPanel projectSlug="portal" />));
  await click("Add deployment"); await click("Connect an existing deployment");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Code only");
  await act(async () => (document.querySelector('input[type="radio"]') as HTMLInputElement).click());
  await click("Connect deployment");
  expect(mutations).toEqual([{ action: "enroll", candidateId: "compose:portal", projectId: 7, environmentName: "Production", hostId: 3 }]);
});
