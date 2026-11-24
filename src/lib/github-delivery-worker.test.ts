// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
const { executeBuildPublish } = createRequire(import.meta.url)("../../scripts/agent-operation-worker.cjs");
afterEach(() => vi.unstubAllGlobals());
const sha = "a".repeat(40);
function fixture(body: Record<string, unknown>, revoked = false) {
 const grant = { id: 4, scope: "deployment:redeploy", resources: "[9]", user: { id: 1, username: "admin", role: "admin" } };
 const current = { id: "build-op", grantId: 4, deploymentId: 9, type: "deployment.build_publish", inputJson: JSON.stringify({ commitSha: sha, branch: "main", releaseAfterBuild: true }), grant, deployment: { slug: "portal" } };
 const queue = vi.fn().mockResolvedValue({ id: "release-op" }); const update = vi.fn();
 const tx = { oAuthGrant: { findUnique: async () => ({ ...grant, revokedAt: revoked ? new Date() : null }) }, agentOperation: { upsert: queue, update } };
 const db = { agentOperation: { findUnique: async () => current, update }, $transaction: (run: (value: unknown) => unknown) => run(tx) };
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
 return { queue, update, run: () => executeBuildPublish({ prisma: db, operation: current, baseUrl: "http://localhost", jwtSecret: "fixture" }) };
}
const good = { success: true, commitSha: sha, images: [{ service: "web", digest: `ghcr.io/team/portal@sha256:${"b".repeat(64)}` }], tests: { status: "passed" } };
it("uses the existing build route and queues one digest release after successful verification", async () => {
 const f = fixture(good); await f.run();
 expect(fetch).toHaveBeenCalledWith("http://localhost/api/projects/compose/build-publish", expect.anything());
 expect(f.queue.mock.calls[0][0].create).toMatchObject({ grantId: 4, deploymentId: 9, type: "deployment.release" });
 expect(JSON.parse(f.queue.mock.calls[0][0].create.inputJson)).toMatchObject({ buildOperationId: "build-op", commitSha: sha });
 expect(JSON.parse(f.update.mock.calls[0][0].data.resultJson).releaseOperationId).toBe("release-op");
});
for (const bad of [{ tests: { status: "failed" } }, { commitSha: "c".repeat(40) }, { images: [] }, { images: [{ digest: "ghcr.io/team/portal:latest" }] }]) it(`blocks release with invalid build evidence ${JSON.stringify(bad)}`, async () => { const f = fixture({ ...good, ...bad }); await f.run(); expect(f.queue).not.toHaveBeenCalled(); expect(f.update.mock.calls[0][0].data.status).toBe("failed"); });
it("rechecks the grant after a build finishes and before creating its release", async () => { const f = fixture(good, true); await expect(f.run()).rejects.toThrow("revoked"); expect(f.queue).not.toHaveBeenCalled(); });
