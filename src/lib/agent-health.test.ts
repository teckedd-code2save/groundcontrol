// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), dns: vi.fn() }));
vi.mock("@/lib/vps", async (original) => ({ ...await original<typeof import("./vps")>(), execOnVps: mocks.exec, getDockerComposeCommand: vi.fn().mockResolvedValue("docker compose") }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.dns }));
vi.mock("./host-exec", () => ({ execOnTargetStrict: mocks.exec }));
import { overallHealth, probePublicUrl, runtimeHealth } from "./agent-health";
import type { VpsConnection } from "./vps";
const vps = { id: 7 } as VpsConnection;
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
it("static health never requires Docker and missing public evidence is unknown", async () => {
  const runtime = await runtimeHealth({ kind: "static" }, vps);
  expect(runtime).toMatchObject({ healthy: null, checked: false });
  expect(mocks.exec).not.toHaveBeenCalled();
  expect(overallHealth(runtime, { checked: false })).toBeNull();
  expect(overallHealth(runtime, { checked: true, healthy: true })).toBe(true);
  expect(overallHealth(runtime, { checked: true, healthy: false })).toBe(false);
});
it.each(["healthy", "unhealthy", "starting"])("uses exact standalone identity and Docker %s state", async (health) => {
  mocks.exec.mockResolvedValue({ code: 0, stdout: `"/app"|"image"|"running"|"${health}"` });
  const result = await runtimeHealth({ kind: "container", containerName: "app" }, vps);
  expect(result.healthy).toBe(health === "healthy");
  expect(mocks.exec.mock.calls[0][0]).toContain("'app'");
  expect(mocks.exec.mock.calls[0][0]).not.toContain("app-");
  expect(mocks.exec.mock.calls[0][1]).toBe(vps);
});
it("selects Compose containers by recorded project and file, not a name prefix", async () => {
  mocks.exec.mockResolvedValueOnce({ code: 0, stdout: "a".repeat(64) }).mockResolvedValueOnce({ code: 0, stdout: '"/odd-name"|"image"|"running"|null' });
  expect((await runtimeHealth({ kind: "compose", composePath: "/srv/app/custom.yml", metadataJson: '{"composeProject":"staging"}' }, vps)).healthy).toBe(true);
  expect(mocks.exec.mock.calls[0][0]).toContain("-p 'staging'");
  expect(mocks.exec.mock.calls[0][0]).toContain("/srv/app/custom.yml");
  expect(mocks.exec.mock.calls[1][0]).toContain("a".repeat(64));
});
it("reports failed inspections as unknown and empty runtimes as unhealthy", async () => {
  mocks.exec.mockResolvedValueOnce({ code: 1, stdout: "" });
  expect((await runtimeHealth({ kind: "container", containerName: "app" }, vps)).healthy).toBeNull();
  mocks.exec.mockResolvedValueOnce({ code: 0, stdout: "" });
  expect((await runtimeHealth({ kind: "compose", sourcePath: "/srv/app" }, vps)).healthy).toBe(false);
  expect(overallHealth({ kind: "container", healthy: true }, { checked: false })).toBeNull();
});
it("does not probe private URLs or count redirects as public verification", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302 })); vi.stubGlobal("fetch", fetch);
  expect(await probePublicUrl("http://127.0.0.1")).toMatchObject({ checked: false });
  expect(fetch).not.toHaveBeenCalled();
  mocks.dns.mockResolvedValue([{ address: "93.184.216.34" }]);
  expect(await probePublicUrl("https://example.com")).toMatchObject({ checked: true, healthy: false });
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
});
