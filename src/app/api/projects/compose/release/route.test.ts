// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const f = vi.hoisted(() => ({ target: vi.fn(), head: vi.fn(), exec: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: () => ({ id: 1, role: "admin" }) }));
vi.mock("@/lib/agent-operation-target", () => ({ agentOperationTarget: f.target, assertAgentProject: () => {} }));
vi.mock("@/lib/github-delivery", () => ({ githubBranchHead: f.head, readDelivery: () => ({ branch: "main" }) }));
vi.mock("@/lib/host-exec", () => ({ execOnWorkloadTarget: f.exec }));
vi.mock("@/lib/agent-health", () => ({ agentComposeCommand: async () => "compose ps" }));
vi.mock("@/lib/vps", async original => ({ ...await original<object>(), resolveComposeFile: async () => null }));
import { POST } from "./route";
const sha = "a".repeat(40);
beforeEach(() => { vi.clearAllMocks(); f.target.mockResolvedValue({ input: { githubDelivery: true }, deployment: { id: 9, metadataJson: "{}" }, projectPath: "/srv/portal", vps: { id: 1 } }); f.head.mockResolvedValue(sha); f.exec.mockResolvedValue({ code: 0, stdout: "", stderr: "" }); });
const request = () => new NextRequest("http://localhost/api/projects/compose/release", { method: "POST", body: JSON.stringify({ projectSlug: "portal", commitSha: sha, branch: "main", images: [{ service: "web", ref: `ghcr.io/team/portal:${sha}`, digest: `ghcr.io/team/portal@sha256:${"b".repeat(64)}` }] }) });
it("stops an older build before any host mutation when a new commit reaches the branch", async () => {
 f.head.mockResolvedValue("c".repeat(40)); const response = await POST(request()); expect(response.status).toBe(409); expect((await response.json()).error).toContain("superseded"); expect(f.exec).not.toHaveBeenCalled();
});
it("pins the verified digest when the built commit is still branch head", async () => {
 const response = await POST(request()); expect(response.status).toBe(200); expect((await response.json()).pinned.web).toBe(`ghcr.io/team/portal@sha256:${"b".repeat(64)}`); expect(f.exec).toHaveBeenCalled();
});
