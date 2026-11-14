// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), run: vi.fn(), finish: vi.fn(), evidence: vi.fn(), resolve: vi.fn(), current: vi.fn() }));
vi.mock("./agent-first-launch-config", () => ({ resolveFirstLaunchConfiguration: mocks.resolve }));
vi.mock("./prisma", () => ({ prisma: { enrolledDeployment: { findUnique: mocks.current } } }));
vi.mock("./agent-first-launch", () => ({ claimAgentFirstLaunch: mocks.claim, finishAgentFirstLaunch: mocks.finish, recordFirstLaunchEvidence: mocks.evidence }));
vi.mock("./agent-first-deploy-execution", () => ({ executeAgentFirstDeploy: mocks.run }));
import { executeRuntimeOperation } from "./agent-runtime-execution";
const target = { deployment: { id: 1, kind: "compose" }, operation: { id: "op", type: "deployment.first_launch", grantId: 2, grant: { userId: 3 } }, input: { recipeHash: "a".repeat(64) } } as unknown as Parameters<typeof executeRuntimeOperation>[0];
beforeEach(() => { vi.clearAllMocks(); mocks.claim.mockResolvedValue({ recipe: {}, vps: {} }); });
it.each([
  ["none", false], ["confirmed", true], ["possible", undefined],
] as const)("reports %s host mutation independently of failed health verification", async (hostMutation, applied) => {
  mocks.run.mockResolvedValue({ success: false, status: "uncertain", hostMutation, error: "Health verification failed" });
  const result = await executeRuntimeOperation(target);
  expect(result).toMatchObject({ success: false, uncertain: true, hostMutation });
  expect("applied" in result ? result.applied : undefined).toBe(applied);
  if (hostMutation === "possible") expect(result).not.toHaveProperty("applied");
  expect(mocks.finish).toHaveBeenCalled();
});

it("keeps configuration server-side and rechecks linked project before phases", async () => {
  const configured = { ...target, deployment: { ...target.deployment, legacyProjectId: 9 } };
  const configuration = { version: 1, projectId: 9, profileId: 4, bindings: [] };
  mocks.claim.mockResolvedValue({ recipe: { configuration, proposalId: "proposal_123", repositoryUrl: "https://github.com/example/app", commitSha: "a".repeat(40), composeFile: "compose.yml", composeYaml: "services: { app: {image: nginx}}" }, vps: {} });
  mocks.current.mockResolvedValue({ legacyProjectId: 9 });
  mocks.resolve.mockResolvedValue({ app: { TOKEN: "private-value" } });
  mocks.run.mockImplementation(async (_recipe, _vps, evidence, deps) => {
    expect(await deps.resolveRuntimeConfiguration()).toEqual({ app: { TOKEN: "private-value" } });
    await evidence({ phase: "launch_started" });
    return { success: true, status: "success", hostMutation: "confirmed" };
  });
  const result = await executeRuntimeOperation(configured);
  expect(mocks.resolve).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain("private-value");
  expect(JSON.stringify(mocks.evidence.mock.calls)).not.toContain("private-value");
  mocks.current.mockResolvedValue({ legacyProjectId: 10 });
  await expect(executeRuntimeOperation(configured)).rejects.toThrow("no longer linked");
});
