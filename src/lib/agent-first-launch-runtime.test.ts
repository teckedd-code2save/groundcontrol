// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), run: vi.fn(), finish: vi.fn(), evidence: vi.fn() }));
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
