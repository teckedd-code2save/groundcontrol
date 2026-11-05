// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  enrolledDeployment: { findFirst: vi.fn(), findMany: vi.fn() },
  agentOperation: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
}));
vi.mock("./prisma", () => ({ prisma: db }));
import { executeAgentTool, type AgentAccessContext } from "./mcp-agent";
const context = { grant: { id: 5 }, resources: [7], scopes: new Set(["deployment:read", "deployment:redeploy", "operation:read"]) } as AgentAccessContext;
const deployment = { id: 7, name: "App", slug: "app", kind: "container", containerName: "app", vpsConfigId: 9, managementMode: "track" };
beforeEach(() => { vi.clearAllMocks(); db.enrolledDeployment.findFirst.mockResolvedValue(deployment); db.agentOperation.findUnique.mockResolvedValue(null); db.agentOperation.create.mockImplementation(async ({ data }) => ({ id: "operation-1", ...data, status: "pending" })); });
it("rejects missing scope before database access and resolves only granted IDs", async () => {
  await expect(executeAgentTool({ ...context, scopes: new Set(["deployment:read"]) }, "deployment.restart", { deployment: "app" })).rejects.toThrow(/scope/);
  expect(db.enrolledDeployment.findFirst).not.toHaveBeenCalled();
  db.enrolledDeployment.findFirst.mockResolvedValue(null);
  await expect(executeAgentTool(context, "deployment.restart", { deployment: "other" })).rejects.toThrow(/not available/);
  expect(db.enrolledDeployment.findFirst.mock.calls[0][0].where.AND).toContainEqual({ id: { in: [7] }, kind: { not: "source" } });
  expect(db.agentOperation.create).not.toHaveBeenCalled();
});
it("queues supported tracked standalone restarts and rejects unsupported actions before queueing", async () => {
  const result = await executeAgentTool(context, "deployment.restart", { deployment: "app", idempotencyKey: "restart-001" });
  expect(result).toMatchObject({ reused: false, operation: { status: "pending", type: "deployment.restart", deploymentId: 7 } });
  await expect(executeAgentTool(context, "deployment.redeploy", { deployment: "app", idempotencyKey: "redeploy-001" })).rejects.toThrow(/No recreate specification/);
  expect(db.agentOperation.create).toHaveBeenCalledTimes(1);
});
it("reuses the same operation including uncertain outcomes but rejects key collisions", async () => {
  const args = { deployment: "app", idempotencyKey: "restart-001", reason: "recover" };
  await executeAgentTool(context, "deployment.restart", args);
  const prior = { id: "operation-1", ...db.agentOperation.create.mock.calls[0][0].data, status: "uncertain" };
  db.agentOperation.findUnique.mockResolvedValue(prior);
  expect(await executeAgentTool(context, "deployment.restart", args)).toMatchObject({ reused: true, operation: { status: "uncertain" } });
  for (const changed of [{ ...prior, deploymentId: 8 }, { ...prior, type: "deployment.redeploy" }, { ...prior, inputJson: "{}" }]) {
    db.agentOperation.findUnique.mockResolvedValue(changed);
    await expect(executeAgentTool(context, "deployment.restart", args)).rejects.toThrow(/already bound/);
  }
  expect(db.agentOperation.create).toHaveBeenCalledTimes(1);
});
it("reconciles a concurrent idempotent insert", async () => {
  const args = { deployment: "app", idempotencyKey: "restart-001" };
  await executeAgentTool(context, "deployment.restart", args);
  const prior = { id: "operation-1", ...db.agentOperation.create.mock.calls[0][0].data };
  db.agentOperation.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(prior);
  db.agentOperation.create.mockRejectedValueOnce({ code: "P2002" });
  expect(await executeAgentTool(context, "deployment.restart", args)).toMatchObject({ reused: true });
});
it("reports capability and authorization separately without returning host credentials", async () => {
  db.enrolledDeployment.findMany.mockResolvedValue([{ ...deployment, vpsConfig: { password: "DO_NOT_EMIT" } }]);
  const result = await executeAgentTool({ ...context, scopes: new Set(["deployment:read"]) }, "deployment.list", {});
  expect(result).toMatchObject({ deployments: [{ capabilities: { runtime: "container", operations: { "deployment.restart": { supported: true, authorized: false, available: false } } } }] });
  expect(JSON.stringify(result)).not.toContain("DO_NOT_EMIT");
});
it("operation reads remain bound to current resources and the owning grant", async () => {
  db.agentOperation.findFirst.mockResolvedValue(null);
  await expect(executeAgentTool(context, "operation.get", { operationId: "operation-1" })).rejects.toThrow(/not found/);
  expect(db.agentOperation.findFirst).toHaveBeenCalledWith({ where: { id: "operation-1", grantId: 5, deploymentId: { in: [7] } } });
});
