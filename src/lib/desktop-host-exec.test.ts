// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ active: vi.fn(), remote: vi.fn(), bridge: vi.fn() }));
vi.mock("./vps", () => ({
  getActiveVps: mocks.active,
  execOnVps: mocks.remote,
  execDetached: vi.fn(),
  shQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}));
vi.mock("./docker-host-bridge", () => ({
  canUseDockerHostBridge: mocks.bridge,
  execViaDockerHostBridge: vi.fn(),
  execDetachedViaDockerHostBridge: vi.fn(),
}));
vi.mock("./prisma", () => ({ prisma: {} }));
import { canExecOnHost, execOnHost, execOnTarget, execOnTargetStrict, execOnWorkloadTarget, execDetachedOnTarget } from "./host-exec";

describe("local Docker execution boundaries", () => {
  beforeEach(() => {
    vi.stubEnv("GC_DESKTOP_MODE", "1");
    mocks.active.mockResolvedValue({ id: 1, host: "127.0.0.1", port: 22, username: "root", isLocal: true });
    mocks.remote.mockResolvedValue({ stdout: "remote", stderr: "", code: 0 });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("runs workspace commands without entering the Docker VM", async () => {
    expect(await execOnHost("printf workspace-ok")).toEqual({ stdout: "workspace-ok", stderr: "", code: 0 });
    expect(mocks.bridge).not.toHaveBeenCalled();
    expect(await canExecOnHost()).toBe(false);
  });

  it("refuses operations that require native host access", async () => {
    expect((await execOnTargetStrict("printf host" )).code).toBe(1);
    expect((await execDetachedOnTarget("printf host", "/tmp/log")).code).toBe(1);
    expect(mocks.bridge).not.toHaveBeenCalled();
  });

  it("preserves the caller's command timeout in desktop mode", async () => {
    expect((await execOnHost("sleep 2", { timeout: 50 })).code).not.toBe(0);
  });

  it("uses the mounted Docker socket for a pinned Desktop workload without native host access", async () => {
    const local = await mocks.active(); mocks.active.mockClear();
    await execOnWorkloadTarget("docker inspect approved-id", local, undefined, undefined, { timeout: 120000 });
    expect(mocks.remote).toHaveBeenCalledWith("docker inspect approved-id", local, undefined, undefined, { timeout: 120000 });
    expect(mocks.bridge).not.toHaveBeenCalled();
    expect(mocks.active).not.toHaveBeenCalled();
  });

  it("never substitutes the active host for a missing or selected remote workload", async () => {
    await expect(execOnWorkloadTarget("docker inspect approved-id", null)).rejects.toThrow(/No workload host/);
    const remote = { id: 2, host: "approved.test", port: 22, username: "operator", isLocal: false };
    await execOnWorkloadTarget("docker inspect approved-id", remote);
    expect(mocks.remote).toHaveBeenCalledWith("docker inspect approved-id", remote, undefined, undefined, undefined);
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.bridge).not.toHaveBeenCalled();
  });

  it("honours a selected remote target instead of silently using the workspace", async () => {
    const remote = { id: 2, host: "example.test", port: 22, username: "operator", isLocal: false };
    mocks.active.mockResolvedValue(remote);
    expect((await execOnTarget("printf remote")).stdout).toBe("remote");
    expect(mocks.remote).toHaveBeenCalledWith("printf remote", remote, undefined, undefined);
  });
});
