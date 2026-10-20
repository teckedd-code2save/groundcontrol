import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddProjectFlow } from "./AddProjectFlow";
let root: Root; let container: HTMLDivElement;
const added = vi.fn(); const close = vi.fn(); const posts: unknown[] = [];
let failList = false;
const repository = { name: "portal", fullName: "team/portal", url: "https://github.com/team/portal", private: true, defaultBranch: "develop", description: "Customer account app" };
beforeEach(() => {
  posts.length = 0; failList = false; added.mockReset(); close.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("requestAnimationFrame", () => 0);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST") { posts.push(JSON.parse(init.body)); return new Response(JSON.stringify({ project: { id: 7, name: "Customer Portal", slug: "portal" } })); }
    if (String(url).includes("/project-import/")) return new Response(JSON.stringify({ repository }));
    if (failList) return new Response(JSON.stringify({ error: "GitHub is temporarily unavailable" }), { status: 502 });
    return new Response(JSON.stringify({ access: "github_app", repositories: [{ ...repository, id: "1" }] }));
  }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(text: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim().startsWith(text) || b.getAttribute("aria-label") === text); expect(button, text).toBeTruthy(); await act(async () => button!.click()); }
async function render() { await act(async () => root.render(<AddProjectFlow localDesktop hostId={1} onClose={close} onAdded={added} />)); }
it("offers both sources and reviews a private GitHub project before creation", async () => {
  await render(); expect(document.body.textContent).toContain("Choose a folder"); await click("Import from GitHub");
  expect(document.body.textContent).toContain("Private"); await click("team/portal");
  expect(document.body.textContent).toContain("Review project"); expect(document.body.textContent).toContain("develop"); expect(posts).toEqual([]);
  const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Customer Portal"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await click("Add project");
  expect(posts).toEqual([{ repositoryUrl: repository.url, name: "Customer Portal", description: repository.description }]); expect(added).toHaveBeenCalledWith("Customer Portal", { id: 7, name: "Customer Portal", slug: "portal" }); expect(close).toHaveBeenCalled();
});
it("can recover a failed GitHub list and return to choosing a source without a write", async () => {
  failList = true; await render(); await click("Import from GitHub"); expect(document.querySelector('[role="alert"]')?.textContent).toContain("temporarily unavailable");
  failList = false; await click("Refresh repositories"); expect(document.body.textContent).toContain("team/portal");
  await click("Change source"); expect(document.body.textContent).toContain("Choose a folder"); expect(posts).toEqual([]);
});
