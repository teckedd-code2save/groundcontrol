import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { listTemplates } from "@/lib/template-engine";
import TemplatesPage from "./page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
let root: Root; let container: HTMLDivElement;
let missing = false; let wrongHost = false;
const calls: { url: string; body?: Record<string, unknown> }[] = [];
beforeEach(() => {
  calls.length = 0; missing = false; wrongHost = false;
  window.history.replaceState({}, "", "/templates?projectId=7&hostId=1&environment=Staging&source=github");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const path = String(url); calls.push({ url: path, body: init?.body ? JSON.parse(init.body) : undefined });
    let data: unknown = {};
    if (path === "/api/templates" && init?.method === "POST") data = { preview: "Reviewed configuration", dockerCompose: "services: {}" };
    else if (path === "/api/templates/deploy") data = { success: true, slug: "portal-staging", enrolled: true };
    else if (path === "/api/project-groups") data = { hostId: wrongHost ? 2 : 1, hostName: "Existing host", projects: [{ id: 7, name: "Portal", repositoryUrl: "https://github.com/team/private", repositoryDefaultBranch: "develop" }] };
    else if (path === "/api/templates") data = missing ? { templates: [], error: "Deployment templates are missing" } : { templates: listTemplates() };
    else if (path === "/api/templates/validate-source") data = { ok: true, checks: [], repo: { name: "Portal" } };
    return new Response(JSON.stringify(data));
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<TemplatesPage />)); }
it("opens the connected repository and branch directly without launching anything", async () => {
  await render();
  expect(document.body.textContent).toContain("Deploy from GitHub");
  const values = [...document.querySelectorAll("input")].map(i => i.value);
  expect(values).toContain("https://github.com/team/private"); expect(values).toContain("develop");
  expect(document.body.textContent).toContain("Portal / Staging");
  expect(calls.every(c => !c.body)).toBe(true);
});
it("shows missing deployment assets instead of an empty silent catalog", async () => {
  missing = true; await render(); expect(document.body.textContent).toContain("Deployment templates are missing");
  expect(calls.every(c => !c.body)).toBe(true);
});
it("does not prepare the GitHub launch after the selected host changes", async () => {
  wrongHost = true; await render(); expect(document.body.textContent).toContain("selected host changed");
  expect([...document.querySelectorAll("input")].some(i => i.value === "https://github.com/team/private")).toBe(false);
  expect(calls.every(c => !c.body)).toBe(true);
});

it("carries the project, environment and selected host through review into deployment", async () => {
  await render();
  async function click(text: string) {
    const button = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
    expect(button, text).toBeTruthy(); await act(async () => button!.click());
  }
  const sourceNext = [...document.querySelectorAll("button")].find(b => b.textContent?.includes("Check & continue"));
  expect(sourceNext).toBeTruthy(); await act(async () => sourceNext!.click());
  await click("Preview →");
  expect(calls.some(c => c.url === "/api/templates/deploy")).toBe(false);
  await click("Deploy");
  expect(calls.find(c => c.url === "/api/templates/deploy")?.body).toMatchObject({ projectGroupId: 7, environmentName: "Staging", hostId: 1, repoUrl: "https://github.com/team/private", branch: "develop" });
});
