// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("./host-exec", () => ({ execOnTarget: mocks.exec }));
vi.mock("./vps", () => ({ getActiveVps: vi.fn(), shQuote: (s: string) => `'${s}'` }));
vi.mock("./runtime", () => ({ isDesktopMode: () => false }));
import { probeServerLayout } from "./server-probe";
beforeEach(() => { mocks.exec.mockReset(); });
function setup(installed: boolean, ready: boolean) {
  mocks.exec.mockImplementation(async (command: string) => {
    if (command.startsWith("docker --version")) return { code: 0, stdout: installed ? "yes" : "no", stderr: "" };
    if (command.startsWith("docker info")) return { code: ready ? 0 : 1, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  });
}
it("distinguishes missing Docker from an installed but unreachable daemon", async () => {
  setup(false, false);
  expect(await probeServerLayout()).toMatchObject({ dockerAvailable: false, dockerReady: false, dockerStatus: "missing" });
  expect(mocks.exec.mock.calls.some(([cmd]) => cmd.startsWith("docker info"))).toBe(false);
  setup(true, false);
  expect(await probeServerLayout()).toMatchObject({ dockerAvailable: true, dockerReady: false, dockerStatus: "unreachable" });
});
it("only calls Docker ready after its daemon responds", async () => {
  setup(true, true);
  expect(await probeServerLayout()).toMatchObject({ dockerAvailable: true, dockerReady: true, dockerStatus: "ready" });
});
it("never describes a failed host probe as missing Docker", async () => {
  mocks.exec.mockRejectedValue(new Error("SSH unavailable"));
  expect(await probeServerLayout()).toMatchObject({ dockerReady: false, dockerStatus: "unknown" });
});
