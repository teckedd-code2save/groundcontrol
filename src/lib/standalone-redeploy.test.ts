// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), operation: vi.fn(), enrollment: vi.fn() }));
vi.mock("./host-exec", () => ({ execOnTargetStrict: mocks.exec, execOnWorkloadTarget: mocks.exec }));
vi.mock("./prisma", () => ({ prisma: { agentOperation: { update: mocks.operation }, enrolledDeployment: { updateMany: mocks.enrollment } } }));
import { redeployStandalone } from "./standalone-redeploy";
import { captureStandaloneRecipe, type ContainerSnapshot } from "./standalone-recipe";

type Target = Parameters<typeof redeployStandalone>[0];
const oldId = "a".repeat(64), newId = "b".repeat(64), imageId = `sha256:${"c".repeat(64)}`;
function initial(): ContainerSnapshot {
  return { Id: oldId, Name: "/gc-app-demo", Image: imageId, Config: { Image: "demo:latest", Hostname: "old-host", Labels: { "io.groundcontrol.project": "2", "io.groundcontrol.deployment": "7" }, Env: ["SECRET=not-exposed"], Volumes: null }, HostConfig: { NetworkMode: "default", PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] } }, Mounts: [], NetworkSettings: { Ports: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] }, Networks: { bridge: {} } }, State: { Running: true, Status: "running" } };
}
function harness(options: { failStart?: boolean; transportStart?: boolean; driftCandidate?: boolean; hijackedCandidate?: boolean; unhealthy?: boolean; failRollback?: boolean; driftOriginal?: boolean; healthyAfterInspections?: number } = {}) {
  const old = initial();
  const recipe = captureStandaloneRecipe(old, { deploymentId: 7, projectId: 2, containerName: "gc-app-demo", containerPort: 8080, hostPort: 49152 })!;
  const metadataJson = JSON.stringify({ source: "local-image", manualPublicUrl: "http://127.0.0.1:49152", recreateRecipe: recipe });
  const target = { deployment: { id: 7, projectGroupId: 2, kind: "container", containerName: "gc-app-demo", metadataJson }, operation: { id: "op-1" }, vps: { id: 9, host: "approved-host" } } as unknown as Target;
  const containers = new Map([[oldId, old]]);
  if (options.driftOriginal) old.Config.Env = ["CHANGED=true"];
  const commands: string[] = [];
  let startingInspections = 0;
  mocks.exec.mockImplementation(async (command: string, vps) => {
    expect(vps).toBe(target.vps); commands.push(command);
    const quoted = [...command.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    if (command.startsWith("docker inspect")) {
      const value = containers.get(quoted.at(-1)!);
      if (value?.Id === newId && value.State.Running && options.healthyAfterInspections && ++startingInspections >= options.healthyAfterInspections) value.State.Health = { Status: "healthy" };
      return value ? { code: 0, stdout: JSON.stringify(value) } : { code: 1, stdout: "" };
    }
    if (command.startsWith("docker create")) {
      const candidate = structuredClone(initial()); candidate.Id = newId; candidate.Name = options.hijackedCandidate ? "/other-workload" : "/gc-candidate-op-1";
      candidate.Config.Image = imageId;
      candidate.HostConfig.PortBindings = { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] };
      candidate.State = { Running: false, Status: "created" }; candidate.NetworkSettings = { Ports: null, Networks: {} };
      if (options.driftCandidate) candidate.HostConfig.Memory = 1;
      containers.set(newId, candidate); return { code: 0, stdout: newId };
    }
    const container = containers.get(quoted[0]);
    if (!container) throw new Error("Unexpected target");
    if (command.startsWith("docker stop")) { container.State = { Running: false, Status: "exited" }; container.NetworkSettings.Ports = null; }
    else if (command.startsWith("docker rename")) container.Name = `/${quoted[1]}`;
    else if (command.startsWith("docker rm")) containers.delete(quoted[0]);
    else if (command.startsWith("docker start")) {
      if (container.Id === newId && options.transportStart) throw new Error("Transport lost after dispatch");
      if (container.Id === newId && options.failStart || container.Id === oldId && options.failRollback) return { code: 1, stdout: "" };
      container.State = { Running: true, Status: "running", ...(container.Id === newId && (options.unhealthy || options.healthyAfterInspections) ? { Health: { Status: options.unhealthy ? "unhealthy" : "starting" } } : {}) };
      container.NetworkSettings = { Ports: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] }, Networks: { bridge: {} } };
    } else throw new Error(`Unexpected command: ${command}`);
    return { code: 0, stdout: container.Id };
  });
  return { target, commands, containers };
}
beforeEach(() => { vi.clearAllMocks(); mocks.operation.mockResolvedValue({}); mocks.enrollment.mockResolvedValue({ count: 1 }); });
it("prepares a pinned replacement, preserves the private port, verifies it and retains the original", async () => {
  const h = harness();
  const result = await redeployStandalone(h.target);
  expect(result).toMatchObject({ success: true, runtimeVerified: true, publicVerified: false, previousContainerRetained: true });
  const create = h.commands.find((c) => c.startsWith("docker create"))!;
  expect(create).toContain("--pull never"); expect(create).toContain(imageId); expect(create).toContain("127.0.0.1:49152:8080");
  expect(h.commands.indexOf(create)).toBeLessThan(h.commands.findIndex((c) => c.startsWith("docker stop")));
  expect(h.containers.get(oldId)).toMatchObject({ Name: "/gc-previous-op-1", State: { Running: false } });
  expect(h.containers.get(newId)).toMatchObject({ Name: "/gc-app-demo", State: { Running: true } });
  expect(JSON.stringify(mocks.operation.mock.calls)).not.toContain("not-exposed");
  const saved = JSON.parse(mocks.enrollment.mock.calls[0][0].data.metadataJson);
  expect(saved.recreateRecipe.containerId).toBe(newId); expect(saved.manualPublicUrl).toBe("http://127.0.0.1:49152");
});
it.each([{ driftOriginal: true }, { driftCandidate: true }, { hijackedCandidate: true }])("never stops the original on unverified identity/configuration: %j", async (options) => {
  const h = harness(options);
  const result = await redeployStandalone(h.target);
  expect(result).not.toMatchObject({ success: true });
  expect(h.commands.some((c) => c.startsWith("docker stop"))).toBe(false);
  if (options.hijackedCandidate) expect(h.commands.some((c) => c.startsWith("docker rm"))).toBe(false);
});
it.each([{ failStart: true }, { unhealthy: true }])("restores and verifies the original after a confirmed replacement failure: %j", async (options) => {
  const h = harness(options);
  expect(await redeployStandalone(h.target)).toMatchObject({ success: false, rollbackVerified: true });
  expect(h.containers.get(oldId)).toMatchObject({ Name: "/gc-app-demo", State: { Running: true } });
  expect(h.containers.has(newId)).toBe(false);
  expect(mocks.enrollment).not.toHaveBeenCalled();
});
it("does not replay or roll back blindly after transport loss", async () => {
  const h = harness({ transportStart: true });
  await expect(redeployStandalone(h.target)).rejects.toThrow(/Transport lost/);
  expect(h.commands.some((c) => c.startsWith("docker rm"))).toBe(false);
  expect(JSON.parse(mocks.operation.mock.calls.at(-1)![0].data.evidenceJson)).toMatchObject({ previousContainerId: oldId, candidateId: newId, phase: "standalone_switching" });
});
it("reports failed rollback as uncertain and retains exact recovery identities", async () => {
  const h = harness({ failStart: true, failRollback: true });
  expect(await redeployStandalone(h.target)).toMatchObject({ uncertain: true, rollbackVerified: false, previousContainerId: oldId });
});
it("does not overwrite enrollment changed during execution", async () => {
  const h = harness(); mocks.enrollment.mockResolvedValue({ count: 0 });
  expect(await redeployStandalone(h.target)).toMatchObject({ uncertain: true, applied: true });
  expect(h.containers.get(oldId)?.State.Running).toBe(false);
  expect(h.containers.get(newId)?.State.Running).toBe(true);
});
it("restores a previously stopped container without starting it on replacement failure", async () => {
  const h = harness({ failStart: true });
  h.containers.get(oldId)!.State = { Running: false, Status: "exited" };
  h.containers.get(oldId)!.NetworkSettings.Ports = null;
  expect(await redeployStandalone(h.target)).toMatchObject({ success: false, rollbackVerified: true });
  expect(h.commands.some((c) => c.startsWith("docker stop") || c === `docker start '${oldId}'`)).toBe(false);
  expect(h.containers.get(oldId)?.State.Running).toBe(false);
});
it("rejects unstable original state before preparing a replacement", async () => {
  const h = harness(); h.containers.get(oldId)!.State.Paused = true;
  expect(await redeployStandalone(h.target)).toMatchObject({ success: false });
  expect(h.commands.every((c) => c.startsWith("docker inspect"))).toBe(true);
});
it("allows normal healthcheck startup intervals before verifying a replacement", async () => {
  const h = harness({ healthyAfterInspections: 32 });
  expect(await redeployStandalone(h.target, { pause: async () => {} })).toMatchObject({ success: true, runtimeVerified: true });
  expect(h.commands.some((c) => c.startsWith("docker rm"))).toBe(false);
});
