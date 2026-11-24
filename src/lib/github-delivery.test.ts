// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), enrollment: vi.fn(), client: vi.fn(), grant: vi.fn(), update: vi.fn(), queue: vi.fn(), access: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { $transaction: (run: (tx: unknown) => unknown) => run({ user: { findUnique: mocks.user }, enrolledDeployment: { findUniqueOrThrow: mocks.enrollment, update: mocks.update }, oAuthClient: { upsert: mocks.client }, oAuthGrant: { upsert: mocks.grant }, agentOperation: { upsert: mocks.queue } }) } }));
vi.mock("./github-source-deploy", async original => ({ ...await original<object>(), sourceAccessForDeployment: mocks.access }));
import { runtimeIdentity } from "./agent-runtime-capabilities";
import { deliveryCommit, deliveryOptions, githubBranchHead, startGithubDelivery, verifyActionsBuild } from "./github-delivery";
const sha = "a".repeat(40);
const policy = { executor: "actions" as const, branch: "main", workflowName: "Build & Publish", autoDeploy: true };
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ role: "admin" }); mocks.enrollment.mockResolvedValue({ id: 9, name: "Portal", kind: "compose", sourcePath: "/srv/portal", composePath: "/srv/portal/compose.yml", vpsConfigId: 1, metadataJson: '{"composeProject":"gc_portal"}' }); mocks.client.mockResolvedValue({ id: 10 }); mocks.grant.mockResolvedValue({ id: 11 }); mocks.queue.mockResolvedValue({ id: "build-op" }); mocks.access.mockResolvedValue({ token: "fixture", repository: { fullName: "team/portal" } }); });
it("creates only an internal, deployment-specific grant for the first reviewed launch", async () => {
 await startGithubDelivery(1, 9, sha, policy);
 expect(mocks.client.mock.calls[0][0].create).toMatchObject({ redirectUris: "[]", source: "internal" });
 expect(mocks.grant.mock.calls[0][0].create).toMatchObject({ userId: 1, resources: "[9]" });
 expect(mocks.queue.mock.calls[0][0].create).toMatchObject({ deploymentId: 9, type: "deployment.build_publish", grantId: 11 });
 expect(JSON.parse(mocks.queue.mock.calls[0][0].create.inputJson)).toMatchObject({ commitSha: sha, verifyPublished: true, releaseAfterBuild: true });
 expect(JSON.parse(mocks.update.mock.calls[0][0].data.metadataJson)).toMatchObject({ composeProject: "gc_portal", githubDelivery: { grantId: 11 } });
});
it("refuses an owner who lost deployment permission before any grant is made", async () => {
 mocks.user.mockResolvedValue({ role: "viewer" }); await expect(startGithubDelivery(1, 9, sha, policy)).rejects.toThrow("Administrator"); expect(mocks.client).not.toHaveBeenCalled();
});
it("only accepts successful trusted branch builds from the selected Actions workflow", () => {
 const payload = { action: "completed", repository: { full_name: "team/portal" }, workflow_run: { name: "Build & Publish", status: "completed", conclusion: "success", head_branch: "main", head_sha: sha, event: "push", head_repository: { full_name: "team/portal" } } };
 expect(deliveryCommit("workflow_run", payload, policy)).toBe(sha);
 for (const change of [{ conclusion: "failure" }, { event: "pull_request" }, { head_branch: "feature" }, { name: "Lint only" }, { head_repository: { full_name: "fork/portal" } }]) expect(deliveryCommit("workflow_run", { ...payload, workflow_run: { ...payload.workflow_run, ...change } }, policy)).toBeNull();
 expect(deliveryCommit("push", { ref: "refs/heads/main", after: sha }, policy)).toBeNull();
 expect(deliveryCommit("push", { ref: "refs/heads/main", after: sha }, { ...policy, executor: "agent" })).toBe(sha);
 expect(deliveryCommit("push", { ref: "refs/heads/main", after: sha }, { ...policy, executor: "agent", autoDeploy: false })).toBeNull();
});
it("requires an explicit workflow and safe branch", () => {
 expect(() => deliveryOptions({ executor: "actions" }, "main")).toThrow("workflow");
 expect(() => deliveryOptions({ executor: "agent" }, "main; bad")).toThrow("safe branch");
});
it("does not treat an image tag alone as proof of a successful Actions build", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ workflow_runs: [] }))));
 await expect(verifyActionsBuild(9, sha, "main", "Build & Publish")).rejects.toThrow("Wait for"); vi.unstubAllGlobals();
});

it("preserves the identity of a prepared deployment with a saved project", async () => {
 const deployment = { id: 9, name: "Portal", kind: "compose", sourcePath: "/srv/portal", composePath: "/srv/portal/compose.yml", vpsConfigId: 1, legacyProject: { id: 17, path: "/srv/portal", category: "app" } };
 mocks.enrollment.mockResolvedValue(deployment);
 await startGithubDelivery(1, 9, sha, policy);
 expect(mocks.enrollment).toHaveBeenCalledWith(expect.objectContaining({ include: { legacyProject: true } }));
 expect(JSON.parse(mocks.queue.mock.calls[0][0].create.inputJson).runtimeIdentity).toBe(runtimeIdentity(deployment));
});
it("does not fall back to an older passing Actions run when the latest matching run failed", async () => {
 const run = { id: 2, name: "Build & Publish", head_sha: sha, head_branch: "main", status: "completed", conclusion: "failure", event: "push", head_repository: { full_name: "team/portal" } };
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ workflow_runs: [run, { ...run, id: 1, conclusion: "success" }] }))));
 try { await expect(verifyActionsBuild(9, sha, "main", "Build & Publish")).rejects.toThrow("Wait for"); } finally { vi.unstubAllGlobals(); }
});

it("uses the linked repository default branch when an agent omits the branch", async () => {
 mocks.access.mockResolvedValue({ token: "fixture", repository: { fullName: "team/portal", defaultBranch: "master" } });
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ sha }))));
 try { expect(await githubBranchHead(9)).toBe(sha); expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/team/portal/commits/master", expect.anything()); } finally { vi.unstubAllGlobals(); }
});
