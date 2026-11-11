// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ find: vi.fn(), auth: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { agentOperation: { findUnique: mocks.find } } }));
vi.mock("./auth", () => ({ requireAuth: mocks.auth }));
import { agentOperationTarget, assertAgentProject } from "./agent-operation-target";
import { runtimeIdentity } from "./agent-runtime-capabilities";
const deployment = { id: 7, slug: "app", kind: "container", containerName: "exact-app", vpsConfigId: 9, vpsConfig: { id: 9, host: "approved-host" } };
const operation = { id: "op-1", type: "deployment.restart", status: "running", deployment, inputJson: JSON.stringify({ runtimeIdentity: runtimeIdentity(deployment) }), grant: { userId: 1, scope: "deployment:redeploy", resources: "[7]", user: { role: "admin", forcePasswordChange: false } } };
const req = () => new NextRequest("http://localhost/api/agent-operations/runtime", { headers: { "X-GroundControl-Agent-Operation": "op-1" } });
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ id: 1 }); mocks.find.mockResolvedValue(operation); });
it("selects only the enrolled host and runtime identity", async () => {
  const target = await agentOperationTarget(req(), ["deployment.restart"]);
  expect(target?.vps).toMatchObject({ id: 9, host: "approved-host" });
  expect(target?.logFile).toBe("/tmp/gc-agent-op-1.log");
  expect(() => assertAgentProject(target, "other")).toThrow(/does not match/);
});
it.each([
  { revokedAt: new Date() }, { resources: "[8]" }, { scope: "deployment:read" },
  { userId: 2 }, { user: { role: "user" } }, { user: { role: "admin", forcePasswordChange: true } },
])("denies changed approval %j immediately before execution", async (grant) => {
  mocks.find.mockResolvedValue({ ...operation, grant: { ...operation.grant, ...grant } });
  await expect(agentOperationTarget(req(), ["deployment.restart"])).rejects.toThrow(/authoriz/);
});
it("denies altered targets, missing hosts and completed operations", async () => {
  for (const altered of [
    { ...operation, deployment: { ...deployment, containerName: "other" } },
    { ...operation, deployment: { ...deployment, vpsConfig: null } },
    { ...operation, status: "success" },
  ]) {
    mocks.find.mockResolvedValue(altered);
    await expect(agentOperationTarget(req(), ["deployment.restart"])).rejects.toThrow();
  }
});

it("allows the worker to observe already-running detached work after revocation", async () => {
  mocks.find.mockResolvedValue({ ...operation, status: "verifying", grant: { ...operation.grant, revokedAt: new Date(), resources: "[]" } });
  expect((await agentOperationTarget(req(), ["deployment.restart"], true))?.vps.id).toBe(9);
});
