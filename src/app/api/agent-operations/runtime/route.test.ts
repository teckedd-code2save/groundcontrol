// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ find: vi.fn(), claim: vi.fn(), auth: vi.fn(), execute: vi.fn(), compose: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { agentOperation: { findUnique: mocks.find, updateMany: mocks.claim } } }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/agent-runtime-execution", () => ({ executeRuntimeOperation: mocks.execute }));
vi.mock("@/app/api/projects/compose/route", () => ({ POST: mocks.compose }));
import { POST } from "./route";
const request = () => new NextRequest("http://localhost/api/agent-operations/runtime", { method: "POST", headers: { "X-GroundControl-Agent-Operation": "op-123" }, body: JSON.stringify({ deployment: "unauthorized", host: "other", action: "remove" }) });
function operation() {
  return { id: "op-123", status: "running", type: "deployment.restart", inputJson: "{}", deployment: { id: 7, slug: "app", kind: "container", containerName: "app", vpsConfigId: 9, vpsConfig: { id: 9, host: "approved" } }, grant: { userId: 1, scope: "deployment:redeploy", resources: "[7]", user: { role: "admin" } } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ id: 1 }); mocks.find.mockResolvedValue(operation()); mocks.claim.mockResolvedValue({ count: 1 }); mocks.execute.mockResolvedValue({ success: true, applied: true }); });
it("ignores client target overrides and executes the durable approved operation", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(mocks.execute.mock.calls[0][0]).toMatchObject({ vps: { id: 9 }, deployment: { id: 7, containerName: "app" } });
  expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "op-123", status: "running", evidenceJson: null } }));
});
it("does not execute a duplicate HTTP dispatch", async () => {
  mocks.claim.mockResolvedValue({ count: 0 });
  const result = await POST(request());
  expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ uncertain: true });
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.compose).not.toHaveBeenCalled();
});
it("does not dispatch an unsupported or revoked operation", async () => {
  for (const current of [{ ...operation(), type: "deployment.redeploy" }, { ...operation(), grant: { ...operation().grant, revokedAt: new Date() } }]) {
    mocks.find.mockResolvedValue(current);
    expect((await POST(request())).status).not.toBe(200);
  }
  expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it("forwards Compose with the saved runtime identity and requested branch", async () => {
  const current = operation();
  mocks.find.mockResolvedValue({ ...current, type: "deployment.source.deploy", inputJson: '{"branch":"staging"}', deployment: { ...current.deployment, kind: "compose", composePath: "/srv/app/custom.yml", githubRepositories: [{}] } });
  mocks.compose.mockResolvedValue(NextResponse.json({ success: true, detached: true }));
  expect(await (await POST(request())).json()).toMatchObject({ success: true, detached: true });
  const forwarded = mocks.compose.mock.calls[0][0] as NextRequest;
  expect(await forwarded.json()).toEqual({ projectSlug: "app", projectPath: "/srv/app", composePath: "/srv/app/custom.yml", action: "source-deploy", branch: "staging" });
  expect(forwarded.headers.get("X-GroundControl-Agent-Operation")).toBe("op-123");
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("surfaces a lost execution reply as uncertain", async () => {
  mocks.execute.mockRejectedValue(new Error("connection lost"));
  expect(await (await POST(request())).json()).toMatchObject({ uncertain: true });
});
