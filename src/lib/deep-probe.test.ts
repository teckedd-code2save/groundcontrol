// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("./server-probe", () => ({ probeServerLayout: async () => ({ dockerAvailable: true, dockerReady: true, dockerStatus: "ready", osFamily: "debian" }) }));
vi.mock("./host-capabilities", () => ({ getHostCapabilities: async () => ({}) }));
vi.mock("./probe-containers", async () => { const { HttpError } = await import("./errors"); return { probeContainers: async () => { throw new HttpError("Docker access denied. Check permissions.", 503); } }; });
vi.mock("./probe-reverse-proxy", () => ({ probeReverseProxy: async () => ({ type: "none", configPaths: [], listening: { port80: false, port443: false } }) }));
vi.mock("./probe-projects", () => ({ probeProjects: async () => [{ path: "/fixture/app", composeServices: ["web"] }] }));
vi.mock("./vps", () => ({ getActiveVps: async () => ({ isLocal: true }) }));
vi.mock("./runtime", () => ({ isDesktopMode: () => false }));
import { deepProbe } from "./deep-probe";
it("preserves failed container discovery and does not suggest starting apparently missing apps", async () => {
  const result = await deepProbe();
  expect(result.error).toBe("Docker access denied. Check permissions.");
  expect(result.summary).toContain("count not verified");
  expect(result.summary).not.toContain("Containers: 0 running");
  expect(result.questions.some((q) => q.id.startsWith("project-down"))).toBe(false);
});
