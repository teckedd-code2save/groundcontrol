// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
const { executeRedeploy, recoverInterrupted, reconcileDetached } = createRequire(import.meta.url)("../../scripts/agent-operation-worker.cjs");
afterEach(() => vi.unstubAllGlobals());
function operation() { return { id: "operation-1", deploymentId: 7, type: "deployment.restart", status: "running", grant: { scope: "deployment:redeploy", resources: "[7]", user: { id: 1, username: "admin", role: "admin" } }, deployment: { slug: "app" } }; }
function harness(current = operation()) {
  const update = vi.fn();
  const prisma = { agentOperation: { findUnique: vi.fn().mockResolvedValue(current), findMany: vi.fn().mockResolvedValue([current]), update } };
  return { prisma, operation: current, baseUrl: "http://localhost", jwtSecret: "test-only", update };
}
it.each([
  [{ success: true, applied: true }, "success"],
  [{ success: false, applied: true, error: "Verification failed" }, "failed"],
  [{ uncertain: true, error: "Already started" }, "uncertain"],
  [{}, "uncertain"],
  [{ success: true, detached: true }, "verifying"],
])("persists runtime outcome %j as %s", async (body, status) => {
  const h = harness(); const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body))); vi.stubGlobal("fetch", fetch);
  await executeRedeploy(h);
  expect(fetch.mock.calls[0][0]).toBe("http://localhost/api/agent-operations/runtime");
  expect(fetch.mock.calls[0][1].headers["X-GroundControl-Agent-Operation"]).toBe("operation-1");
  expect(h.update.mock.calls[0][0].data.status).toBe(status);
});
it.each([{ resources: "[]" }, { scope: "deployment:read" }, { revokedAt: new Date() }, { user: { id: 1, username: "admin", role: "user" } }])("blocks changed grants before dispatch: %j", async (grant) => {
  const current = { ...operation(), grant: { ...operation().grant, ...grant } }; const h = harness(current);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await executeRedeploy(h);
  expect(fetch).not.toHaveBeenCalled();
  expect(h.update.mock.calls[0][0].data.status).toBe("failed");
});
it("marks interrupted work uncertain without replaying any mutation", async () => {
  const h = harness(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await recoverInterrupted(h.prisma);
  expect(fetch).not.toHaveBeenCalled();
  expect(h.update.mock.calls[0][0].data).toMatchObject({ status: "uncertain", leaseUntil: null });
});
it("preserves exact container recovery identities when a runtime reply is uncertain", async () => {
  const h = harness();
  h.prisma.agentOperation.findUnique.mockResolvedValueOnce(h.operation).mockResolvedValueOnce({ evidenceJson: JSON.stringify({ previousContainerId: "old-id", candidateId: "new-id", phase: "standalone_switching" }) });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ uncertain: true, error: "Connection lost" }), { status: 500 })));
  await executeRedeploy(h);
  expect(JSON.parse(h.update.mock.calls[0][0].data.evidenceJson)).toMatchObject({ previousContainerId: "old-id", candidateId: "new-id", phase: "standalone_switching", recovery: "inspect_before_retry" });
});
it("reconciles detached evidence using the exact operation header", async () => {
  const h = harness({ ...operation(), type: "deployment.redeploy", status: "verifying" });
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success" }))); vi.stubGlobal("fetch", fetch);
  await reconcileDetached(h);
  expect(fetch.mock.calls[0][1].headers["X-GroundControl-Agent-Operation"]).toBe("operation-1");
  expect(h.update.mock.calls[0][0].data.status).toBe("success");
});
