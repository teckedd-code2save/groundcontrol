// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), desktop: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => ({ ...await importOriginal<typeof import("node:crypto")>(), randomInt: () => 49152 }));
vi.mock("./vps", async (importOriginal) => ({ ...await importOriginal<typeof import("./vps")>(), execOnVps: mocks.exec }));
vi.mock("./runtime", () => ({ isDesktopMode: mocks.desktop }));
vi.mock("./prisma", () => ({ prisma: {
  projectGroup: { findUnique: vi.fn().mockResolvedValue({ id: 2, slug: "demo" }) },
  enrolledDeployment: { create: mocks.create, update: mocks.update, delete: mocks.remove },
} }));
import { launchLocalProject } from "./local-project-launch";
import { runtimeCapabilities } from "./agent-runtime-capabilities";

const vps = { id: 9, isLocal: true } as Parameters<typeof launchLocalProject>[1];
const body = { projectId: 2, name: "Demo", image: "demo:latest", containerPort: 8080 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.desktop.mockReturnValue(true);
  mocks.create.mockImplementation(async ({ data }) => ({ ...data, id: 7 }));
  mocks.update.mockImplementation(async ({ data }) => ({ ...mocks.create.mock.calls[0][0].data, ...data, id: 7 }));
});
function startup(mounts: unknown[] = [], running = true) {
  mocks.exec.mockImplementation(async (command: string) => {
    if (!command.startsWith("docker inspect")) return { code: 0, stdout: "a".repeat(64) };
    return { code: 0, stdout: JSON.stringify({
      Id: "a".repeat(64), Name: `/${mocks.create.mock.calls[0][0].data.containerName}`, Image: `sha256:${"c".repeat(64)}`,
      Config: { Image: "demo:latest", Hostname: "captured-host", Labels: { "io.groundcontrol.project": "2", "io.groundcontrol.deployment": "7" }, Env: ["TOKEN=do-not-persist"] },
      HostConfig: { NetworkMode: "default", PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] } },
      Mounts: mounts, NetworkSettings: { Ports: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] }, Networks: { bridge: {} } }, State: { Running: running, Status: running ? "running" : "exited" },
    }) };
  });
}
it("captures a mount-free local launch so an enrolled image can be redeployed without Compose", async () => {
  startup();
  const deployed = await launchLocalProject(body, vps);
  expect(mocks.exec.mock.calls.find(([command]) => command.startsWith("docker run"))?.[0]).toContain("127.0.0.1:49152:8080");
  expect(runtimeCapabilities(deployed).operations["deployment.redeploy"].supported).toBe(true);
  expect(JSON.parse(deployed.metadataJson)).toMatchObject({ manualPublicUrl: "http://127.0.0.1:49152", recreateRecipe: { imageId: `sha256:${"c".repeat(64)}`, containerId: "a".repeat(64), hostPort: 49152, containerPort: 8080 } });
  expect(deployed.metadataJson).not.toContain("do-not-persist");
});
it("keeps mounted images available for restart without inventing a storage recreation policy", async () => {
  startup([{ Type: "volume", Name: "image-created-volume" }]);
  const deployed = await launchLocalProject(body, vps);
  expect(runtimeCapabilities(deployed).operations["deployment.restart"].supported).toBe(true);
  expect(runtimeCapabilities(deployed).operations["deployment.redeploy"].supported).toBe(false);
});
it("does not save a recreate recipe when initial startup fails", async () => {
  startup([], false);
  await expect(launchLocalProject(body, vps)).rejects.toThrow(/exited during startup/);
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 7 } });
});
