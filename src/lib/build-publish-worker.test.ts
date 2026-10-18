// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
const { executeBuildPublish } = createRequire(import.meta.url)("../../scripts/agent-operation-worker.cjs");
afterEach(() => vi.unstubAllGlobals());

for (const success of [true, false]) {
  it(`persists complete, parseable ${success ? "successful" : "failed"} build evidence`, async () => {
    const current = { id: "op", type: "deployment.build_publish", deploymentId: 3, inputJson: JSON.stringify({ commitSha: "a".repeat(40) }), grant: { resources: "[3]", user: { id: 1, username: "admin", role: "admin" } }, deployment: { slug: "proof" } };
    const logs = [{ phase: "build", code: success ? 0 : 23, stdout: "start\n" + "x".repeat(50000), stderr: "FINAL_FAILURE" }];
    const body = { ...(success ? { images: [], tests: { status: "passed" } } : { error: "Build failed" }), logs };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: success ? 200 : 400 })));
    const update = vi.fn();
    await executeBuildPublish({ prisma: { agentOperation: { findUnique: async () => current, update } }, operation: current, baseUrl: "http://localhost", jwtSecret: "test-only" });
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe(success ? "success" : "failed");
    expect(JSON.parse(data.evidenceJson).logs).toEqual(logs);
    if (success) expect(JSON.parse(data.resultJson).logs).toEqual(logs);
  });
}
