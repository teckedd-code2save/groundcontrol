import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeploymentWorkspace } from "./DeploymentWorkspace";

let root: Root;
let container: HTMLDivElement;
let hidden = false;
let enrolled = false;
let scanError = false;
const candidate = { id: "compose:shop", name: "shop", sourcePath: "/Users/me/shop", kind: "compose", evidence: ["2 services · Docker Compose"], services: [{ name: "web", containerName: "shop-web", image: "web:1", state: "running" }, { name: "database", containerName: "shop-db", image: "postgres:17", state: "running" }] };
const project = { name: "source-app", sourcePath: "/Users/me/projects/source-app", technologies: ["JavaScript / TypeScript"], markers: ["package.json"], composePath: null };
const mutations: Record<string, unknown>[] = [];

beforeEach(() => {
  hidden = false; enrolled = false; scanError = false; mutations.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    let data: unknown;
    let status = 200;
    if (init?.method === "POST") {
      const body = JSON.parse(init.body); mutations.push(body);
      if (body.action === "dismiss") hidden = true;
      if (body.action === "restore" || body.action === "restore_all") hidden = false;
      if (body.action === "add_source") enrolled = true;
      if (body.action === "browse_folders") return new Response(JSON.stringify({ path: body.sourcePath || "/Users/me", parentPath: body.sourcePath ? "/Users/me" : null, roots: [{ name: "Home", path: "/Users/me" }], breadcrumbs: [{ name: "Home", path: "/Users/me" }], folders: body.sourcePath ? [] : [{ name: "projects", path: "/Users/me/projects" }], canSelect: true }));
      data = body.action === "inspect_folder" ? { root: "/Users/me/projects", projects: [project], folder: project } : { project, ok: true };
      if (body.action === "inspect_folder" && scanError) { data = { error: "Allow the folder in Docker Desktop File sharing." }; status = 400; }
    } else data = { projects: [], deployments: [], candidates: hidden ? [] : [candidate], hiddenCount: hidden ? 1 : 0, localDesktop: true, hostId: 7 };
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const button = [...(document.querySelector('[role="dialog"]') || document).querySelectorAll("button")].find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label);
  expect(button, label).toBeTruthy(); await act(async () => button!.click());
}
async function enterFolder(value: string) {
  const input = document.querySelector('input:not([type="radio"])') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("dismisses one grouped app, keeps it hidden on refresh, and restores it with undo", async () => {
  await act(async () => root.render(<DeploymentWorkspace />));
  expect(container.querySelectorAll("details")).toHaveLength(1);
  expect(container.textContent).toContain("View 2 services");
  await click("Dismiss shop");
  expect(container.textContent).toContain("Restore hidden (1)");
  await click("Refresh discovery");
  expect(container.textContent).not.toContain("Track app");
  await click("Undo");
  expect(container.textContent).toContain("Track app");
  expect(mutations.map((body) => body.action)).toEqual(["dismiss", "restore"]);
  expect(mutations[0]).toMatchObject({ candidateId: candidate.id, hostId: 7 });
});

it("previews a non-Compose source before explicit add and marks it as not deployed", async () => {
  await act(async () => root.render(<DeploymentWorkspace />));
  await click("Add project"); await click("Choose a folderBrowse this computer and pick your project folder."); await click("Open folder projects"); await click("Use this folder");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("JavaScript / TypeScript");
  expect(mutations.map((body) => body.action)).toEqual(["browse_folders", "browse_folders", "inspect_folder"]);
  await click("Add project");
  expect(mutations[3]).toMatchObject({ action: "add_source", sourcePath: project.sourcePath, hostId: 7 });
  expect(container.textContent).toContain("no deployment has been started");
  expect(container.textContent).not.toContain("Needs attention");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("allows retry after a folder access failure without adding anything", async () => {
  scanError = true;
  await act(async () => root.render(<DeploymentWorkspace />));
  await click("Add project"); await click("Choose a folderBrowse this computer and pick your project folder."); await click("Open folder projects"); await click("Use this folder");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("File sharing");
  expect(document.body.textContent).not.toContain("Project found");
  scanError = false; await click("Use this folder");
  expect(document.body.textContent).toContain("Project found");
  expect(mutations.some((body) => body.action === "add_source")).toBe(false);
});
