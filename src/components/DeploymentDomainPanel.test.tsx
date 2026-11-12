import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DeploymentDomainPanel } from "./DeploymentDomainPanel";

it("keeps optional public routing collapsed without a domain and preserves its action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); const root = createRoot(container); const apply = vi.fn();
  try {
    await act(async () => root.render(<DeploymentDomainPanel value="" onChange={() => {}} busy={false} onApply={apply} />));
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.textContent).toContain("Private services and workers can stay without a domain");
    expect(container.querySelector("button")?.disabled).toBe(true);
    await act(async () => root.render(<DeploymentDomainPanel domain="old.example.com" value="new.example.com" onChange={() => {}} busy={false} onApply={apply} />));
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("summary")?.textContent).toContain("old.example.com");
    await act(async () => container.querySelector("button")!.click());
    expect(apply).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
