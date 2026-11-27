// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ host: vi.fn(), container: vi.fn() }));
vi.mock("./host-exec", () => ({ execOnWorkloadTarget: f.host }));
vi.mock("./command-output", () => ({ captureCommand: f.container }));
import { resolveComposeFile, type VpsConnection } from "./vps";

const vps: VpsConnection = { id: 1, host: "203.0.113.10", isLocal: true, port: 22, username: "root" };
const path = "/srv/groundcontrol/deployments/clearline";
const file = `${path}/compose.groundcontrol.yml`;
beforeEach(() => {
  vi.clearAllMocks();
  f.container.mockResolvedValue({ stdout: "", stderr: "" });
  f.host.mockResolvedValue({ code: 0, stdout: `${file}\n`, stderr: "" });
});

it("finds an explicit Compose file on the workload host even when it is absent in the control-plane container", async () => {
  expect(await resolveComposeFile(path, vps, file)).toBe(file);
  expect(f.host).toHaveBeenCalledWith(expect.stringContaining(`test -f '${file}'`), vps);
  expect(f.container).not.toHaveBeenCalled();
});

it("uses the workload filesystem for default filename discovery too", async () => {
  expect(await resolveComposeFile(path, vps)).toBe(file);
  expect(f.host).toHaveBeenCalledWith(expect.stringContaining(`cd '${path}'`), vps);
});

it("does not turn unavailable host access into a misleading missing-file error", async () => {
  f.host.mockResolvedValue({ code: 1, stdout: "", stderr: "GroundControl cannot access the host execution plane" });
  await expect(resolveComposeFile(path, vps, file)).rejects.toThrow(/host execution/);
});
