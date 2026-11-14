// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./agent-app-domain-publish", () => ({ getActiveAppDomainBinding: vi.fn(async () => null) }));
vi.mock("./prisma", () => ({ prisma: { enrolledDeployment: { findFirst: vi.fn() }, agentOperation: { findUnique: vi.fn(), create: vi.fn() }, agentDeploymentRecipe: { findUnique: vi.fn() } } }));
import { prisma } from "./prisma";
import { executeAgentTool, type AgentAccessContext } from "./mcp-agent";
const recipeHash = "a".repeat(64);
const context = { scopes: new Set(["deployment:redeploy"]), resources: [1], grant: { id: 2 }, user: { id: 3 } } as AgentAccessContext;
const deployment = { id: 1, slug: "app", kind: "compose", vpsConfigId: 4, sourcePath: "/srv/original", composePath: "/srv/original/compose.yml", metadataJson: JSON.stringify({ agentEnrollment: { recipeHash, firstLaunchState: "success" } }) };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS", "1");
  vi.mocked(prisma.enrolledDeployment.findFirst).mockResolvedValue(deployment as never);
  vi.mocked(prisma.agentOperation.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.agentDeploymentRecipe.findUnique).mockResolvedValue({ status: "success", recipeHash, userId: 3 } as never);
  vi.mocked(prisma.agentOperation.create).mockImplementation((args) => Promise.resolve({ ...args.data, id: "op", status: "pending", attempts: 0, createdAt: new Date(), updatedAt: new Date(), startedAt: null, finishedAt: null }) as never);
});
afterEach(() => vi.unstubAllEnvs());
it.each([{ branch: "main" }, {}, { commitSha: "main" }, { commitSha: "a".repeat(40), branch: "main" }])("requires immutable SHA without branch fallback %j", async args => {
  await expect(executeAgentTool(context, "deployment.source.deploy", { deployment: "app", idempotencyKey: "source-key", ...args })).rejects.toThrow();
  expect(prisma.agentOperation.create).not.toHaveBeenCalled();
});
it("queues an exact SHA under the existing scope without fake repository linking", async () => {
  await executeAgentTool(context, "deployment.source.deploy", { deployment: "app", idempotencyKey: "source-key", commitSha: "B".repeat(40) });
  const args = vi.mocked(prisma.agentOperation.create).mock.calls[0][0];
  expect(JSON.parse(args.data.inputJson as string)).toMatchObject({ commitSha: "b".repeat(40), recipeHash, publicSourceRecipe: true });
});
it("keeps ordinary linked source branch requests unchanged", async () => {
  vi.mocked(prisma.enrolledDeployment.findFirst).mockResolvedValue({ ...deployment, metadataJson: "{}", githubRepositories: [{}] } as never);
  await executeAgentTool(context, "deployment.source.deploy", { deployment: "app", idempotencyKey: "legacy-key", branch: "main" });
  const input = JSON.parse(vi.mocked(prisma.agentOperation.create).mock.calls[0][0].data.inputJson as string);
  expect(input.branch).toBe("main"); expect(input).not.toHaveProperty("publicSourceRecipe");
});
it("returns original operation for identical key after its successful path switch", async () => {
  const args = { deployment: "app", idempotencyKey: "stable-update", commitSha: "b".repeat(40) };
  await executeAgentTool(context, "deployment.source.deploy", args);
  const saved = vi.mocked(prisma.agentOperation.create).mock.calls[0][0].data;
  vi.mocked(prisma.agentOperation.findUnique).mockResolvedValue({ ...saved, id: "same-op", status: "success", attempts: 1, createdAt: new Date(), updatedAt: new Date(), startedAt: null, finishedAt: new Date() } as never);
  vi.mocked(prisma.enrolledDeployment.findFirst).mockResolvedValue({ ...deployment, sourcePath: "/srv/new-release", composePath: "/srv/new-release/effective.yml" } as never);
  expect(await executeAgentTool(context, "deployment.source.deploy", args)).toMatchObject({ reused: true, operation: { id: "same-op" } });
  expect(prisma.agentOperation.create).toHaveBeenCalledTimes(1);
  await expect(executeAgentTool(context, "deployment.source.deploy", { ...args, commitSha: "c".repeat(40) })).rejects.toThrow("different deployment");
});
