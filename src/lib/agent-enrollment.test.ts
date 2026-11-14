// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./prisma", () => ({ prisma: { oAuthGrant: { findUnique: vi.fn() }, oAuthToken: { findUnique: vi.fn() }, agentDeploymentProposal: { upsert: vi.fn(), findFirst: vi.fn() } } }));
import { normalizeDeploymentProposal, deploymentProposalContentHash, createAgentDeploymentProposal, getAgentDeploymentProposal } from "./agent-enrollment";
import { prisma } from "./prisma";
import type { AgentAccessContext } from "./mcp-agent";
const raw = { repositoryUrl: "https://github.com/example/service", revision: "a".repeat(40), runtime: "compose", composePath: "deploy/compose.yml", workloadName: "demo", idempotencyKey: "request-0001" };
const context = { scopes: new Set(["deployment:propose"]), token: { id: 2 }, grant: { id: 3 }, user: { id: 1 } } as AgentAccessContext;
const grant = { id: 3, userId: 1, clientDbId: 4, consentRevision: 1, scope: "deployment:propose", resources: "[]", revokedAt: null, user: { role: "admin", forcePasswordChange: false } };
function authorized() {
  vi.stubEnv("GC_AGENT_ENROLLMENT_PROPOSALS", "1");
  vi.mocked(prisma.oAuthToken.findUnique).mockResolvedValue({ id: 2, grantId: 3, kind: "access", scope: "deployment:propose", revokedAt: null, expiresAt: new Date(Date.now()+60000) } as never);
  vi.mocked(prisma.oAuthGrant.findUnique).mockResolvedValue(grant as never);
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("bounded inert deployment proposals", () => {
  it("canonicalizes immutable revisions without storing idempotency metadata in content", () => {
    const a = normalizeDeploymentProposal(raw);
    expect(a).not.toHaveProperty("idempotencyKey");
    expect(deploymentProposalContentHash(a)).toEqual(deploymentProposalContentHash(normalizeDeploymentProposal({ ...raw, revision: "A".repeat(40), repositoryUrl: raw.repositoryUrl + ".git" })));
  });
  it.each(["https://evil.com/a/b", "https://user:password@github.com/a/b", "https://github.com/a/b?token=x", "https://github.com/a/b#secret", "http://github.com/a/b", "https://github.com/a/.."]) ("rejects unsafe repository %s", repositoryUrl => expect(() => normalizeDeploymentProposal({ ...raw, repositoryUrl })).toThrow());
  it.each(["../compose.yml", "/compose.yml", "a/../compose.yml", "a\\compose.yml", "a\0.yml", "a/./compose.yml"])("rejects unsafe path %s", composePath => expect(() => normalizeDeploymentProposal({ ...raw, composePath })).toThrow());
  it("rejects unknown fields, mutable refs and unsupported runtimes", () => {
    for (const patch of [{ secrets: "password" }, { revision: "main" }, { runtime: "dockerfile" }, { serverId: -1 }]) expect(() => normalizeDeploymentProposal({ ...raw, ...patch })).toThrow();
  });
  it("rejects when feature disabled or old scopes are used", async () => {
    await expect(createAgentDeploymentProposal(context,raw)).rejects.toThrow("not enabled");
    authorized();
    await expect(createAgentDeploymentProposal({ ...context, scopes: new Set(["deployment:redeploy"]) },raw)).rejects.toThrow("Missing scope");
    expect(prisma.agentDeploymentProposal.upsert).not.toHaveBeenCalled();
  });
  it("rechecks revoked grants before storing", async () => {
    authorized(); vi.mocked(prisma.oAuthGrant.findUnique).mockResolvedValue({ ...grant, revokedAt: new Date() } as never);
    await expect(createAgentDeploymentProposal(context,raw)).rejects.toThrow("no longer authorized");
    expect(prisma.agentDeploymentProposal.upsert).not.toHaveBeenCalled();
  });
  it("creates idempotently with a scoped unique key and no execution", async () => {
    authorized();
    vi.mocked(prisma.agentDeploymentProposal.upsert).mockImplementation((args) => Promise.resolve({ ...args.create, id: "proposal1", status: "pending", createdAt: new Date() }) as never);
    const result = await createAgentDeploymentProposal(context, raw);
    expect(result.status).toBe("pending"); expect(result.notice).toContain("does not grant permission to run");
    expect(prisma.agentDeploymentProposal.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { grantId_idempotencyKey: { grantId: 3, idempotencyKey: raw.idempotencyKey } }, update: {} }));
  });
  it("rejects idempotency reuse with altered content", async () => {
    authorized(); vi.mocked(prisma.agentDeploymentProposal.upsert).mockResolvedValue({ contentHash: "different", grantHash: "different" } as never);
    await expect(createAgentDeploymentProposal(context,raw)).rejects.toThrow("different proposal");
  });
  it("preserves expiry on retry rather than renewing the proposal", async () => {
    authorized();
    vi.mocked(prisma.agentDeploymentProposal.upsert).mockImplementation((args) => Promise.resolve({ ...args.create, id: "expired1", status: "pending", expiresAt: new Date(0), createdAt: new Date(0) }) as never);
    expect((await createAgentDeploymentProposal(context, raw)).status).toBe("expired");
  });
  it("rejects a token revoked after the request context was created", async () => {
    authorized(); vi.mocked(prisma.oAuthToken.findUnique).mockResolvedValue(null);
    await expect(createAgentDeploymentProposal(context, raw)).rejects.toThrow("token is no longer authorized");
    expect(prisma.agentDeploymentProposal.upsert).not.toHaveBeenCalled();
  });
  it("does not reveal another grant's proposal", async () => {
    authorized(); vi.mocked(prisma.agentDeploymentProposal.findFirst).mockResolvedValue(null);
    await expect(getAgentDeploymentProposal(context, "other")).rejects.toThrow("not found");
    expect(prisma.agentDeploymentProposal.findFirst).toHaveBeenCalledWith({ where: { id: "other", grantId: 3, userId: 1 } });
  });
});
