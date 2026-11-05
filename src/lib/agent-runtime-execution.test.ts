// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), health: vi.fn(), probe: vi.fn(), sync: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock("./vps", async (original) => ({ ...await original<typeof import("./vps")>(), execOnVps: mocks.exec }));
vi.mock("./agent-health", async (original) => ({ ...await original<typeof import("./agent-health")>(), runtimeHealth: mocks.health, probePublicUrl: mocks.probe }));
vi.mock("./github-source-deploy", () => ({ syncGithubDeploymentSource: mocks.sync }));
vi.mock("./prisma", () => ({ prisma: { deployment: { findFirst: mocks.find, create: mocks.create, update: mocks.update } } }));
vi.mock("./host-exec", () => ({ execOnTargetStrict: mocks.exec, execOnWorkloadTarget: mocks.exec }));
import { executeRuntimeOperation } from "./agent-runtime-execution";
type Target = Parameters<typeof executeRuntimeOperation>[0];
function target(type = "deployment.redeploy"): Target {
  return { operation: { id: "op-123", type }, deployment: { id: 7, kind: "static", sourcePath: "/src/site", legacyProject: { id: 2, path: "/www/site", category: "static", outputDir: "dist", buildCommand: "npm run build" } }, input: { branch: "staging" }, vps: { id: 9, host: "approved" } } as unknown as Target;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.exec.mockResolvedValue({ code: 0, stdout: "" });
  mocks.find.mockResolvedValue({ id: 1, targetId: 3, branch: "main", commitSha: "old", publicUrl: "https://example.com" });
  mocks.create.mockResolvedValue({ id: 2, branch: "staging" }); mocks.update.mockResolvedValue({});
  mocks.health.mockResolvedValue({ kind: "static", checked: false, healthy: null, containers: [] });
  mocks.probe.mockResolvedValue({ checked: true, healthy: true });
  mocks.sync.mockResolvedValue({ commitSha: "new", branch: "staging" });
});
it("publishes a saved static recipe on the enrolled host without Compose or proxy rewrites", async () => {
  const t = target();
  expect(await executeRuntimeOperation(t)).toMatchObject({ success: true, publicVerified: true, releaseId: 2 });
  expect(mocks.exec.mock.calls.every((call) => call[1] === t.vps)).toBe(true);
  const command = mocks.exec.mock.calls[1][0] as string;
  expect(command).toContain("cp -Rp '/src/site/dist/.' '/www/site.gc-op-123/'");
  expect(command.indexOf("cp -Rp")).toBeLessThan(command.indexOf("mv '/www/site'"));
  expect(command).not.toMatch(/docker|compose|caddy|nginx/);
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "success", commitSha: "old" }) }));
});
it("syncs the requested linked branch for static source deploy", async () => {
  const t = target("deployment.source.deploy");
  await executeRuntimeOperation(t);
  expect(mocks.sync).toHaveBeenCalledWith({ deploymentId: 7, projectPath: "/src/site", branch: "staging", vps: t.vps });
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ commitSha: "new", branch: "staging" }) }));
});
it("does not touch the published files if the build fails", async () => {
  mocks.exec.mockResolvedValueOnce({ code: 2, stderr: "secret=not-for-agent" });
  await expect(executeRuntimeOperation(target())).rejects.toThrow(/build command failed/);
  expect(mocks.exec).toHaveBeenCalledTimes(1);
  expect(mocks.probe).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
  expect(JSON.stringify(mocks.update.mock.calls)).not.toContain("not-for-agent");
});
it("records publish and public verification failures separately", async () => {
  mocks.probe.mockResolvedValue({ checked: true, healthy: false });
  expect(await executeRuntimeOperation(target())).toMatchObject({ success: false, applied: true, publicVerified: false });
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "degraded" }) }));
});
it("does not claim public verification when it was skipped", async () => {
  mocks.probe.mockResolvedValue({ checked: false, reason: "No URL" });
  expect(await executeRuntimeOperation(target())).toMatchObject({ success: true, applied: true, publicVerified: false, healthy: null });
});
it("reports publish failure and transport exceptions without success", async () => {
  mocks.exec.mockResolvedValueOnce({ code: 0 }).mockResolvedValueOnce({ code: 1 });
  await expect(executeRuntimeOperation(target())).rejects.toThrow(/publish failed/);
  mocks.exec.mockRejectedValueOnce(new Error("SSH connection lost"));
  await expect(executeRuntimeOperation(target())).rejects.toThrow(/SSH connection lost/);
});
it("restarts only the enrolled standalone container and verifies its runtime", async () => {
  const t = target("deployment.restart"); t.deployment = { ...t.deployment, kind: "container", containerName: "app;test", legacyProject: null };
  mocks.health.mockResolvedValue({ kind: "container", checked: true, healthy: true, containers: [] });
  expect(await executeRuntimeOperation(t)).toMatchObject({ success: true, applied: true });
  expect(mocks.exec.mock.calls[0].slice(0, 2)).toEqual(["docker restart 'app;test'", t.vps]);
  mocks.health.mockResolvedValue({ kind: "container", checked: false, healthy: null, containers: [] });
  expect(await executeRuntimeOperation(t)).toMatchObject({ success: false, applied: true });
});

it("stages and swaps real static files while preserving the previous publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "gc-static-runtime-"));
  try {
    const t = target();
    t.deployment.sourcePath = `${root}/source`;
    t.deployment.legacyProject!.path = `${root}/published`;
    t.deployment.legacyProject!.buildCommand = null;
    await mkdir(`${root}/source/dist`, { recursive: true });
    await mkdir(`${root}/published`);
    await writeFile(`${root}/source/dist/index.html`, "new release");
    await writeFile(`${root}/published/index.html`, "previous release");
    mocks.exec.mockImplementation(async (command) => {
      const result = await promisify(execFile)("/bin/sh", ["-c", command]);
      return { ...result, code: 0 };
    });
    await executeRuntimeOperation(t);
    expect(await readFile(`${root}/published/index.html`, "utf8")).toBe("new release");
    expect(await readFile(`${root}/published.prev/index.html`, "utf8")).toBe("previous release");
  } finally { await rm(root, { recursive: true, force: true }); }
});
