// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), active: vi.fn() }));
vi.mock("./host-exec", () => ({ execOnTarget: mocks.exec }));
vi.mock("./vps", () => ({ getActiveVps: mocks.active, shQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'` }));
import { probeContainers } from "./probe-containers";
import { probeProjects } from "./probe-projects";

beforeEach(() => { mocks.active.mockResolvedValue({ isLocal: true }); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("shows user workloads without asking about the application's helpers or own container", async () => {
  const rows = [
    { Names: "customer-api", Image: "my-api:latest", Labels: "com.docker.compose.project=api" },
    { Names: "ephemeral", Image: "groundcontrol-host-bridge:latest", Labels: "" },
    { Names: "new-helper", Image: "some-image:latest", Labels: "io.groundcontrol.internal=terminal" },
    { Names: "groundcontrol-web", Image: "sha256:123", Labels: "" },
  ];
  mocks.exec.mockResolvedValue({ stdout: rows.map((row) => JSON.stringify(row)).join("\n"), stderr: "", code: 0 });
  expect((await probeContainers()).map((row) => row.name)).toEqual(["customer-api"]);
});

it("does not turn its own installation or recovery backups into stopped applications", async () => {
  mocks.exec.mockImplementation(async (command: string) => ({
    stdout: command.startsWith("find ")
      ? "/opt/groundcontrol/docker-compose.yml\n/opt/groundcontrol/backups/20260928/docker-compose.yml\n/opt/shop/compose.yml\n"
      : command.includes("config --services") ? "web\nworker\n" : "no\n",
    stderr: "", code: 0,
  }));
  const projects = await probeProjects();
  expect(projects.map((project) => project.path)).toEqual(["/opt/shop"]);
  expect(projects[0].composeServices).toEqual(["web", "worker"]);
  expect(mocks.exec.mock.calls.slice(1).some(([command]) => command.includes("backups"))).toBe(false);
});

it("uses the shared desktop folder only while the local workspace is selected", async () => {
  vi.stubEnv("GC_DESKTOP_MODE", "1");
  vi.stubEnv("GC_WORKSPACE_ROOT", "/Users/test/shared work");
  mocks.exec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
  await probeProjects();
  expect(mocks.exec.mock.calls[0][0]).toContain("find '/Users/test/shared work'");
  mocks.active.mockResolvedValue({ isLocal: false });
  await probeProjects();
  expect(mocks.exec.mock.calls[1][0]).toContain("find /opt /srv");
});
