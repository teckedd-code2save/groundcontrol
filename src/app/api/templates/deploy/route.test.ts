// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const f = vi.hoisted(() => ({ exec: vi.fn(), queue: vi.fn(), access: vi.fn(), registry: vi.fn(), enroll: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: () => ({ id: 1, role: "admin" }) }));
vi.mock("@/lib/host-exec", () => ({ execOnTarget: f.exec }));
vi.mock("@/lib/vps", async original => ({ ...await original<object>(), getActiveVps: async () => ({ id: 1, isLocal: true }), getSystemConfig: async () => ({}) }));
vi.mock("@/lib/github-project-import", () => ({ githubProjectAccess: f.access }));
vi.mock("@/lib/github-app-service", () => ({ linkGithubRepositoryToDeployment: async () => ({}) }));
vi.mock("@/lib/github-registry", () => ({ githubRegistryPublicState: f.registry }));
vi.mock("@/lib/github-delivery", async original => ({ ...await original<object>(), startGithubDelivery: f.queue }));
vi.mock("@/lib/template-source", () => ({ resolveTemplateSource: async () => ({ kind: "git", sourcePath: "/srv/groundcontrol/deployments/portal", commitSha: "a".repeat(40), githubRepositoryId: "r1", repoUrl: "https://github.com/team/portal", branch: "main" }) }));
vi.mock("@/lib/template-deployment-state", () => ({ persistTemplateDeployment: async () => ({ projectId: 10, deploymentId: 11, targetId: 1 }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { projectGroup: { findUnique: async () => ({ id: 7, slug: "portal" }) }, project: { findUnique: async () => null }, enrolledDeployment: { findUnique: async () => null, upsert: f.enroll }, deployment: { update: async () => ({}) }, deploymentEnvProfile: { update: async () => ({}) } } }));
vi.mock("@/lib/env-management", () => ({ materializeEnvFile: async () => {}, parseEnvSchema: () => [], setLocalEnvValues: async () => {}, upsertEnvProfileForProject: async () => ({ id: 12, providerType: "local" }), validateEnv: () => ({ ok: true, hash: "fixture" }) }));
import { POST } from "./route";
const compose = "services:\n  web:\n    build: .\n    image: ghcr.io/team/portal:latest\n    ports:\n      - '127.0.0.1:8088:3000'\n";
beforeEach(() => { vi.clearAllMocks(); f.access.mockResolvedValue({ repositoryId: "r1", token: "fixture" }); f.registry.mockResolvedValue({ configured: true }); f.enroll.mockResolvedValue({ id: 9 }); f.queue.mockResolvedValue({ id: "build-op" }); f.exec.mockImplementation(async (cmd: string) => ({ code: 0, stderr: "", stdout: cmd.startsWith("cat ") && cmd.includes("docker-compose.yml") || cmd.includes("docker compose -p") ? compose : cmd.includes("ls -1A") ? "Dockerfile\ndocker-compose.yml" : (cmd.startsWith("test -e") || cmd.startsWith("test -f") && cmd.includes("Dockerfile")) ? "yes" : "" })); });
const request = () => new NextRequest("http://localhost/api/templates/deploy", { method: "POST", body: JSON.stringify({ projectGroupId: 7, hostId: 1, environmentName: "Staging", templateName: "vps-caddy-existing-compose", repoUrl: "https://github.com/team/portal", branch: "main", inputs: { domain: "portal.example.com", public_service: "web", public_port: "8088" }, delivery: { executor: "agent", autoDeploy: true } }) });
it("prepares the first GitHub deployment and queues image delivery without starting or building containers inline", async () => {
 const response = await POST(request()); const body = await response.json();
 expect(body, JSON.stringify(body)).toMatchObject({ queued: true, deployed: false, operationId: "build-op" }); expect(response.status).toBe(202);
 expect(f.queue).toHaveBeenCalledWith(1, 9, "a".repeat(40), expect.objectContaining({ executor: "agent", autoDeploy: true }));
 expect(f.exec.mock.calls.some(([cmd]) => /up -d|build --pull|compose pull/.test(cmd))).toBe(false);
});
it("does not create a running app when package access is missing", async () => {
 f.registry.mockResolvedValue({ configured: false }); const response = await POST(request()); expect((await response.json()).error).toContain("package access"); expect(f.exec).not.toHaveBeenCalled(); expect(f.queue).not.toHaveBeenCalled();
});
