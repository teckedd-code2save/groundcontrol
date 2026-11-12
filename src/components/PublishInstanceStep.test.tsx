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
