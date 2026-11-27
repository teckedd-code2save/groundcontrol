// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), host: vi.fn(), find: vi.fn(), labels: vi.fn(), active: vi.fn(), uiActive: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: m.auth }));
vi.mock("@/lib/vps", () => ({ getActiveVps: m.host, getDockerContainerLabels: m.labels, getDockerContainers: vi.fn(), scanProjects: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  enrolledDeployment: { findUnique: m.find },
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ agentOperation: { count: m.active }, deploymentLog: { count: m.uiActive }, enrolledDeployment: { updateMany: m.update } }),
} }));
import { PATCH } from "./route";
const deployment = { id: 4, slug: "shop-production", kind: "compose", managementMode: "managed", vpsConfigId: 1, sourcePath: "/srv/shop-production", composePath: "/srv/shop-production/compose.yml", metadataJson: JSON.stringify({ source: "template", composeProject: "gc_shop_production" }), updatedAt: new Date() };
const request = () => PATCH(new NextRequest("https://gc.test/api/deployment-inventory/shop-production", { method: "PATCH", body: JSON.stringify({ reconcileRuntime: true }) }), { params: Promise.resolve({ slug: "shop-production" }) });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockReturnValue({ role: "admin" }); m.host.mockResolvedValue({ id: 1 }); m.find.mockResolvedValue(deployment);
  m.labels.mockResolvedValue([{ name: "shop-production-app-1", project: "shop-production", service: "app", workingDir: deployment.sourcePath, configFiles: deployment.composePath }]);
  m.active.mockResolvedValue(0); m.uiActive.mockResolvedValue(0); m.update.mockResolvedValue({ count: 1 });
});
it("rechecks host labels and updates only the exact enrollment metadata", async () => {
  expect((await request()).status).toBe(200);
  expect(m.labels).toHaveBeenCalledWith({ id: 1 }, { requireSuccess: true });
  expect(m.update).toHaveBeenCalledWith({ where: { id: 4, updatedAt: deployment.updatedAt, metadataJson: deployment.metadataJson }, data: { metadataJson: expect.any(String) } });
  expect(JSON.parse(m.update.mock.calls[0][0].data.metadataJson).composeProject).toBe("shop-production");
});
it("refuses non-admins and foreign hosts before runtime inspection", async () => {
  m.auth.mockReturnValue({ role: "viewer" }); expect((await request()).status).toBe(403);
  m.auth.mockReturnValue({ role: "admin" }); m.host.mockResolvedValue({ id: 2 }); expect((await request()).status).toBe(404);
  expect(m.labels).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it("refuses missing/ambiguous runtime and active or uncertain operations", async () => {
  m.active.mockResolvedValue(1); expect((await request()).status).toBe(409);
  m.active.mockResolvedValue(0); m.uiActive.mockResolvedValue(1); expect((await request()).status).toBe(409);
  m.labels.mockResolvedValue([]); expect((await request()).status).toBe(409);
  expect(m.update).not.toHaveBeenCalled();
});
it("rejects concurrent enrollment changes", async () => {
  m.update.mockResolvedValue({ count: 0 }); expect((await request()).status).toBe(409);
});
