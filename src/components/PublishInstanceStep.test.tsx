import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PublishInstanceStep from "./PublishInstanceStep";
let root: Root;
let container: HTMLDivElement;
const post = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  post.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method === "POST" ? post(options) : { ok: true, json: async () => ({ mode: "private", localDesktop: false }) }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
it("describes Keep it private as verification, not publication", async () => {
  let finish!: (value: unknown) => void;
  post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Keep it private"); await click("Keep private & verify");
  expect(JSON.parse(post.mock.calls[0][0].body)).toEqual({ action: "private" });
  expect(container.textContent).toContain("Verifying private access…");
  expect(container.textContent).not.toContain("Publishing & verifying…");
  await act(async () => finish({ ok: false, json: async () => ({ error: "Verification unavailable" }) }));
  expect(container.textContent).toContain("Verification unavailable");
  expect(container.textContent).toContain("Keep private & verify");
});


it("discloses temporary public URL limits at handoff and offers permanent setup without publishing", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    mode: "quick_tunnel", publicUrl: "https://temporary.example.test", localDesktop: false,
  }) })));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.textContent).toContain("Temporary access: configure a permanent domain");
  expect(container.textContent).toContain("public HTTPS sign-in link, not a private-only address");
  expect(container.textContent).toContain("does not restart automatically after a server reboot");
  expect(container.textContent).toContain("Recreating it gives you a new URL");
  expect(container.textContent).toContain("do not support server-sent event streams");
  expect(container.querySelector('a[href="https://temporary.example.test"]')).not.toBeNull();
  expect(container.querySelector("#gc-publish-hostname")).toBeNull();
  await click("Set up a permanent domain");
  expect(container.querySelector("#gc-publish-hostname")).not.toBeNull();
  expect(container.querySelector("#gc-cf-token")).not.toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it("does not attach temporary-link warnings to permanent public URLs", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    mode: "cloudflare", publicUrl: "https://gc.example.test", cloudflareConfigured: true,
  }) })));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.textContent).not.toContain("Temporary access: configure a permanent domain");
});


it("reloads the actual handoff URL after a partial retirement failure", async () => {
  let committed = false;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method === "POST") {
      committed = true;
      return { ok: false, json: async () => ({ error: "New access is live; old connector cleanup needs inspection." }) };
    }
    return { ok: true, json: async () => ({ mode: committed ? "cloudflare" : "quick_tunnel", publicUrl: committed ? "https://gc.example.test" : "https://temporary.example.test", cloudflareConfigured: true }) };
  }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Create temporary HTTPS");
  expect(container.querySelector('a[href="https://gc.example.test"]')).not.toBeNull();
  expect(container.querySelector('a[href="https://temporary.example.test"]')).toBeNull();
  expect(container.textContent).toContain("old connector cleanup needs inspection");
});
