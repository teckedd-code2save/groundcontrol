// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ groups: vi.fn(), ungrouped: vi.fn(), active: vi.fn(), host: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/vps", () => ({ getActiveVps: mocks.active }));
vi.mock("@/lib/prisma", () => ({ prisma: { projectGroup: { findMany: mocks.groups }, enrolledDeployment: { findMany: mocks.ungrouped }, vpsConfig: { findUnique: mocks.host } } }));
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("labels active server and deployment while preserving the different source host", async () => {
  vi.stubEnv("GC_DESKTOP_MODE", "0");
  const local = { name: "local", host: "127.0.0.1", isLocal: true };
  mocks.active.mockResolvedValue({ id: 1, ...local }); mocks.host.mockResolvedValue(local);
  mocks.ungrouped.mockResolvedValue([]);
  mocks.groups.mockResolvedValue([{ id: 7, sources: [{ id: 2, path: "/src/app", vpsConfigId: 3, metadataJson: "{}", vpsConfig: { name: "Source host", host: "source.example", isLocal: false } }], enrolledDeployments: [{ id: 4, vpsConfigId: 1, vpsConfig: local, metadataJson: "{}" }] }]);
  const data = await (await GET(new NextRequest("http://gc/api/project-groups"))).json();
  expect(data).toMatchObject({ hostId: 1, hostName: "GroundControl server", localDesktop: false });
  expect(data.projects[0].deployments[0]).toMatchObject({ hostId: 1, hostName: "GroundControl server" });
  expect(data.projects[0].sources[0]).toMatchObject({ hostId: 3, hostName: "Source host" });
});
it("preserves desktop connection labeling", async () => {
  vi.stubEnv("GC_DESKTOP_MODE", "1");
  const local = { name: "This computer", host: "127.0.0.1", isLocal: true };
  mocks.active.mockResolvedValue({ id: 1, ...local }); mocks.host.mockResolvedValue(local);
  mocks.ungrouped.mockResolvedValue([]); mocks.groups.mockResolvedValue([]);
  expect(await (await GET(new NextRequest("http://gc/api/project-groups"))).json()).toMatchObject({ hostId: 1, hostName: "This computer", localDesktop: true });
});
