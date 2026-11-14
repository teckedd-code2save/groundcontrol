// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  upsert: vi.fn(), tokens: vi.fn(), codes: vi.fn(), create: vi.fn(), transaction: vi.fn(),
}));
vi.mock("./prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
import { allowsResourceFreeConsent, replaceConsent } from "./oauth-consent";
const tx = {
  oAuthGrant: { upsert: mocks.upsert },
  oAuthToken: { updateMany: mocks.tokens },
  oAuthAuthorizationCode: { updateMany: mocks.codes, create: mocks.create },
};
const input = { userId: 1, clientDbId: 2, scope: "deployment:propose", resourceIds: [], redirectUri: "https://client.example/callback", codeChallenge: "challenge", codeChallengeMethod: "S256" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.upsert.mockResolvedValue({ id: 7 });
  mocks.transaction.mockImplementation(async (run) => run(tx));
});
afterEach(() => vi.unstubAllEnvs());
describe("proposal-only consent", () => {
  it("is disabled unless explicitly enabled", () => {
    vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS", "0");
    expect(allowsResourceFreeConsent("deployment:propose")).toBe(false);
  });
  it("allows only proposal plus optional offline access", () => {
    vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS", "1");
    expect(allowsResourceFreeConsent("deployment:propose")).toBe(true);
    expect(allowsResourceFreeConsent("offline_access deployment:propose")).toBe(true);
    for (const scope of ["", "offline_access", "deployment:read", "deployment:propose deployment:read", "deployment:propose deployment:redeploy", "deployment:propose operation:read"]) {
      expect(allowsResourceFreeConsent(scope)).toBe(false);
    }
  });
});
describe("consent replacement", () => {
  it("rotates grant, tokens and outstanding codes in one transaction before issuing a code", async () => {
    const code = await replaceConsent(input);
    expect(code).toMatch(/^gc_code/);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { consentRevision: { increment: 1 }, scope: input.scope, resources: "[]", revokedAt: null } }));
    expect(mocks.tokens).toHaveBeenCalledWith({ where: { grantId: 7, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(mocks.codes).toHaveBeenCalledWith({ where: { grantId: 7, usedAt: null }, data: { usedAt: expect.any(Date) } });
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ grantId: 7, scope: input.scope, codeHash: expect.any(String) }) });
    expect(mocks.codes.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
  });
  it("does not issue a code when invalidating earlier authorization fails", async () => {
    mocks.codes.mockRejectedValue(new Error("database failure"));
    await expect(replaceConsent(input)).rejects.toThrow("database failure");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
