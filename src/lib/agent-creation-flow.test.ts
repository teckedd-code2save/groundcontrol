// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { createRequire } from "node:module";
const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient, userId: 0, exec: vi.fn(), failClaim: false, revokeDuringCheckout: false }));
vi.mock("./prisma", () => ({ prisma: new Proxy({}, { get: (_, key) => { const value = Reflect.get(state.db, key); return typeof value === "function" ? value.bind(state.db) : value; } }) }));
vi.mock("./auth", () => ({ requireAuth: () => ({ id: state.userId, role: "admin", username: "test-owner" }), getUserFromToken: () => ({ id: state.userId }) }));
vi.mock("./github-registry", () => ({ githubRegistryPublicState: async () => ({ configured: true }) }));
vi.mock("./github-project-import", async original => ({ ...await original<object>(), githubProjectAccess: async () => ({ repositoryId: "r1", headers: {}, token: "SECRET_NOT_RETURNED" }) }));
vi.mock("./host-exec", () => ({ execOnTarget: state.exec, execOnTargetStrict: state.exec }));
vi.mock("./template-source", () => ({ resolveTemplateSource: async (input: { deployPath: string; branch: string; repoUrl: string }) => {
  if (state.revokeDuringCheckout) await state.db.oAuthGrant.updateMany({ data: { revokedAt: new Date() } });
  return { kind: "git", sourcePath: input.deployPath, commitSha: input.branch, branch: input.branch, repoUrl: input.repoUrl, githubRepositoryId: "r1" };
} }));
import { executeAgentTool, type AgentAccessContext } from "./mcp-agent";
import { POST } from "../app/api/agent-operations/create/route";
import { POST as mcp } from "../app/mcp/route";
import { hashOpaqueToken } from "./oauth";
import { POST as consent } from "../app/api/oauth/authorize/decision/route";
const { executeCreate } = createRequire(import.meta.url)("../../scripts/agent-operation-worker.cjs");
const sha = "a".repeat(40);
const compose = `services:
  web:
    build: .
    image: ghcr.io/team/review:latest
    ports: ["127.0.0.1:8098:3000"]
    environment:
      DATABASE_URL: postgres://app:\${POSTGRES_PASSWORD:?required}@db:5432/app
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?required}
    volumes: ["data:/var/lib/postgresql/data"]
volumes:
  data:
`;
let directory: string;
let context: AgentAccessContext;
let spec: Record<string, unknown>;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "gc-create-test-"));
  const url = `file:${join(directory, "test.db")}`;
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  state.db = new PrismaClient({ datasources: { db: { url } } });
  await state.db.githubAppConnection.create({ data: { id: 1, appId: "test", slug: "test", name: "test", clientId: "test", clientSecretEncrypted: "test", privateKeyEncrypted: "test", webhookSecretEncrypted: "test", publicUrl: "https://gc.example.com" } });
  await state.db.githubInstallation.create({ data: { id: "i1", connectionId: 1, accountLogin: "team" } });
  await state.db.githubRepository.create({ data: { id: "r1", installationId: "i1", owner: "team", name: "review", fullName: "team/review", htmlUrl: "https://github.com/team/review" } });
  vi.stubEnv("GROUNDCONTROL_SECRET", "disposable-test-encryption-key");
}, 30000);
afterAll(async () => { await state.db?.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  vi.clearAllMocks(); state.failClaim = false; state.revokeDuringCheckout = false;
  await state.db.project.deleteMany(); await state.db.projectGroup.deleteMany(); await state.db.vpsConfig.deleteMany(); await state.db.user.deleteMany();
  const user = await state.db.user.create({ data: { username: "test-owner", password: "fixture" } }); state.userId = user.id;
  const host = await state.db.vpsConfig.create({ data: { name: "approved", host: "192.0.2.1", isLocal: true } });
  const client = await state.db.oAuthClient.upsert({ where: { clientId: "test-agent" }, update: {}, create: { clientId: "test-agent", clientName: "test", source: "dynamic", redirectUris: "[]" } });
  const grant = await state.db.oAuthGrant.create({ data: { userId: user.id, clientDbId: client.id, scope: "deployment:create deployment:read deployment:redeploy operation:read", creationHosts: JSON.stringify([host.id]) } });
  await state.db.oAuthToken.create({ data: { grantId: grant.id, tokenHash: hashOpaqueToken("test-bearer"), kind: "access", familyId: "test-family", scope: grant.scope, expiresAt: new Date(Date.now() + 3600000) } });
  context = { grant, user, client, scopes: new Set(grant.scope.split(" ")), resources: [] } as unknown as AgentAccessContext;
  spec = { hostId: host.id, repositoryUrl: "https://github.com/team/review", branch: "main", commitSha: sha, name: "review", composeFile: "compose.yml", domain: "review.example.com", publicService: "web", publicPort: "8098", executor: "actions", workflowName: "Publish", autoDeploy: true, generatedEnvironmentKeys: ["POSTGRES_PASSWORD"], idempotencyKey: "first-review-001" };
  state.exec.mockImplementation(async (command: string) => ({ code: state.failClaim && command.startsWith("mkdir -p '/srv/groundcontrol/deployments' && mkdir") ? 1 : 0, stderr: "", stdout:
    command.startsWith("cat ") && command.includes("compose.yml") || command.includes("docker compose -p") ? compose :
    command.includes("ls -1A") ? "Dockerfile\ncompose.yml" :
    command.includes("caddy adapt") ? '{"apps":{}}' :
    command.startsWith("test -e") || command.startsWith("test -f") && command.includes("Dockerfile") ? "yes" : "" }));
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input.includes("/commits/")) return Response.json({ sha });
    if (input.includes("/contents/")) return Response.json({ type: "file", encoding: "base64", size: compose.length, content: Buffer.from(compose).toString("base64") });
    if (input.endsWith("/api/agent-operations/create")) return POST(new NextRequest(input, init));
    throw new Error("Unexpected external request");
  }));
});
async function queue() {
  const response = await mcp(new NextRequest("http://localhost/mcp", { method: "POST", headers: { Authorization: "Bearer test-bearer", "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "deployment.create", arguments: spec } }) }));
  const body = await response.json();
  if (body.result.isError) throw new Error(body.result.content[0].text);
  return body.result.structuredContent as { operation: { id: string; deploymentId: number }; reused: boolean };
}
async function run(id: string) {
  const operation = await state.db.agentOperation.update({ where: { id }, data: { status: "running" } });
  await executeCreate({ prisma: state.db, operation, baseUrl: "http://localhost", jwtSecret: "test-worker-key" });
  return state.db.agentOperation.findUniqueOrThrow({ where: { id } });
}
it("goes from empty MCP inventory through reservation and the real shared launch to a readable delivery operation", async () => {
  expect(await executeAgentTool(context, "deployment.list", {})).toEqual({ deployments: [] });
  const created = await queue(); expect(created.reused).toBe(false); expect(state.exec).not.toHaveBeenCalled();
  const freshGrant = await state.db.oAuthGrant.findUniqueOrThrow({ where: { id: context.grant.id } });
  await expect(executeAgentTool({ ...context, grant: freshGrant, resources: JSON.parse(freshGrant.resources) }, "deployment.redeploy", { deployment: String(created.operation.deploymentId), idempotencyKey: "not-prepared-001" })).rejects.toThrow(/preparation has not finished/);
  const result = await run(created.operation.id);
  expect(result.status, result.error || "").toBe("success");
  const evidence = JSON.parse(result.resultJson!);
  expect(evidence).toMatchObject({ prepared: true, liveVerified: false, commitSha: sha });
  const grant = await state.db.oAuthGrant.findUniqueOrThrow({ where: { id: context.grant.id } });
  const refreshed = { ...context, grant, resources: JSON.parse(grant.resources) };
  const delivery = await executeAgentTool(refreshed, "operation.get", { operationId: evidence.deliveryOperationId });
  expect(delivery).toMatchObject({ operation: { type: "deployment.build_publish", status: "pending" } });
  const build = await state.db.agentOperation.findUniqueOrThrow({ where: { id: evidence.deliveryOperationId } });
  expect(JSON.parse(build.inputJson)).toMatchObject({ verifyPublished: true, releaseAfterBuild: true, commitSha: sha, actionsWorkflowName: "Publish" });
  expect(build.grantId).toBe(context.grant.id);
  const secret = await state.db.deploymentEnvValue.findFirstOrThrow({ where: { key: "POSTGRES_PASSWORD" } });
  expect(secret.value).toMatch(/^enc:v1:/);
  expect(JSON.stringify({ created, evidence, delivery, input: build.inputJson })).not.toContain(secret.value);
  expect(await state.db.oAuthGrant.count()).toBe(1);
  const target = await state.db.enrolledDeployment.findUniqueOrThrow({ where: { id: created.operation.deploymentId } });
  expect(JSON.parse(target.metadataJson).githubDelivery).toMatchObject({ autoDeploy: true, executor: "actions", grantId: context.grant.id });
  expect(JSON.stringify({ created, evidence, delivery })).not.toContain("SECRET_NOT_RETURNED");
  expect(state.exec.mock.calls.some(([cmd]) => /up -d|build --pull|compose pull/.test(cmd))).toBe(false);
  expect(state.exec.mock.calls.every(([, host]) => host.id === spec.hostId)).toBe(true);
  const again = await queue(); expect(again).toMatchObject({ reused: true, operation: { id: result.id } });
}, 30000);
it("reuses uncertain requests, rejects changed inputs and never reserves an existing name twice", async () => {
  const first = await queue();
  await state.db.agentOperation.update({ where: { id: first.operation.id }, data: { status: "uncertain" } });
  expect(await queue()).toMatchObject({ reused: true, operation: { status: "uncertain" } });
  await expect(executeAgentTool(context, "deployment.create", { ...spec, domain: "changed.example.com" })).rejects.toThrow(/different creation inputs/);
  await expect(executeAgentTool(context, "deployment.create", { ...spec, idempotencyKey: "second-request-002" })).rejects.toThrow(/already exists/);
  expect(await state.db.enrolledDeployment.count()).toBe(1); expect(state.exec).not.toHaveBeenCalled();
});
it("refuses wrong hosts and revocation before worker dispatch without host writes", async () => {
  await expect(executeAgentTool(context, "deployment.create", { ...spec, hostId: 999 })).rejects.toThrow(/not approved/);
  const first = await queue(); await state.db.oAuthGrant.update({ where: { id: context.grant.id }, data: { revokedAt: new Date() } });
  expect((await run(first.operation.id)).status).toBe("failed"); expect(state.exec).not.toHaveBeenCalled();
});
it("stops when the directory already exists and preserves the reservation for inspection", async () => {
  const first = await queue(); state.failClaim = true;
  expect((await run(first.operation.id)).status).toBe("failed");
  expect(await state.db.agentOperation.count({ where: { type: "deployment.build_publish" } })).toBe(0);
  expect(state.exec.mock.calls.some(([cmd]) => cmd.includes("cat >") || /up -d|rm -rf/.test(cmd))).toBe(false);
});
it("rechecks consent after checkout and refuses routing or delivery if it was revoked", async () => {
  const first = await queue(); state.revokeDuringCheckout = true;
  expect((await run(first.operation.id)).status).toBe("failed");
  expect(await state.db.agentOperation.count({ where: { type: "deployment.build_publish" } })).toBe(0);
  expect(state.exec.mock.calls.some(([cmd]) => cmd.includes("cat >") || cmd.includes("reload caddy"))).toBe(false);
});
it("does not replay the HTTP preparation after a lost worker reply", async () => {
  const first = await queue(); await run(first.operation.id);
  const count = state.exec.mock.calls.length;
  const response = await POST(new NextRequest("http://localhost/api/agent-operations/create", { method: "POST", headers: { "X-GroundControl-Agent-Operation": first.operation.id }, body: "{}" }));
  expect(response.status).toBe(409); expect(state.exec).toHaveBeenCalledTimes(count);
});

it("accepts OAuth consent with no deployments only when a creation host is explicitly selected", async () => {
  await state.db.oAuthClient.update({ where: { id: context.client.id }, data: { redirectUris: JSON.stringify(["https://client.example/callback"]) } });
  const query = new URLSearchParams({ response_type: "code", client_id: context.client.clientId, redirect_uri: "https://client.example/callback", scope: context.grant.scope, code_challenge: "a".repeat(43), code_challenge_method: "S256" }).toString();
  const request = (creationHostIds: number[]) => new NextRequest("http://localhost/api/oauth/authorize/decision", { method: "POST", body: JSON.stringify({ query, approved: true, deploymentIds: [], creationHostIds }) });
  expect((await consent(request([]))).status).toBe(400);
  expect((await consent(request([999]))).status).toBe(400);
  const response = await consent(request([Number(spec.hostId)]));
  expect(response.status).toBe(200);
  expect((await response.json()).redirectTo).toContain("https://client.example/callback?code=");
  const grant = await state.db.oAuthGrant.findUniqueOrThrow({ where: { id: context.grant.id } });
  expect(grant.resources).toBe("[]"); expect(grant.creationHosts).toBe(JSON.stringify([spec.hostId]));
});
it("converges concurrent identical creation calls onto one reservation", async () => {
  const [first, second] = await Promise.all([queue(), queue()]);
  expect(first.operation.id).toBe(second.operation.id);
  expect(await state.db.enrolledDeployment.count()).toBe(1);
});
