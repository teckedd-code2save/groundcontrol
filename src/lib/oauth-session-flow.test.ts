// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient, userId: 0 }));
vi.mock("./prisma", () => ({ prisma: new Proxy({}, { get: (_, key) => {
  const value = Reflect.get(state.db, key);
  return typeof value === "function" ? value.bind(state.db) : value;
} }) }));
// Substitute the owner's web login only; consent, token storage, PKCE, rotation
// and the MCP HTTP entry point use the actual implementation and real SQLite.
vi.mock("./auth", () => ({ getUserFromToken: () => ({ id: state.userId }) }));
import { POST as mcp } from "../app/mcp/route";
import { POST as consent } from "../app/api/oauth/authorize/decision/route";
import { POST as token } from "../app/oauth/token/route";
import { hashOpaqueToken, pkceChallenge } from "./oauth";

let directory: string;
let approvedId: number;
let excludedId: number;
const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
const clientId = "renewable-test-client";
const redirectUri = "https://client.example/callback";
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "gc-oauth-session-"));
  writeFileSync(join(directory, "test.db"), "");
  const url = `file:${join(directory, "test.db")}`;
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
    env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  state.db = new PrismaClient({ datasources: { db: { url } } });
}, 30000);
afterAll(async () => {
  await state.db?.$disconnect();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await state.db.auditLog.deleteMany();
  await state.db.oAuthClient.deleteMany();
  await state.db.user.deleteMany();
  await state.db.enrolledDeployment.deleteMany();
  const user = await state.db.user.create({ data: { username: "owner", password: "test-only" } });
  state.userId = user.id;
  await state.db.oAuthClient.create({ data: { clientId, clientName: "Test client", redirectUris: JSON.stringify([redirectUri]) } });
  approvedId = (await state.db.enrolledDeployment.create({ data: { name: "Approved", slug: "approved", kind: "compose" } })).id;
  excludedId = (await state.db.enrolledDeployment.create({ data: { name: "Excluded", slug: "excluded", kind: "compose" } })).id;
});
function call(name: string, access?: string, args: Record<string, unknown> = {}) {
  return mcp(new NextRequest("https://gc.example/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
}
function exchange(params: Record<string, string>) {
  return token(new NextRequest("https://gc.example/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString(),
  }));
}
async function connect(scope: string) {
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    scope, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256" }).toString();
  const response = await consent(new NextRequest("https://gc.example/api/oauth/authorize/decision", {
    method: "POST", body: JSON.stringify({ query, approved: true, deploymentIds: [approvedId] }),
  }));
  expect(response.status).toBe(200);
  const code = new URL((await response.json()).redirectTo).searchParams.get("code")!;
  const tokens = await exchange({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId });
  expect(tokens.status).toBe(200);
  return tokens.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }>;
}
async function expire(access: string) {
  await state.db.oAuthToken.update({ where: { tokenHash: hashOpaqueToken(access) }, data: { expiresAt: new Date(Date.now() - 1000) } });
}

it("uses discovered consent to renew an expired session without another login, keeping resource boundaries and revocation", async () => {
  const discovery = await mcp(new NextRequest("https://gc.example/mcp", {
    method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }));
  const catalog = (await discovery.json()).result.tools as Array<{ name: string; securitySchemes: Array<{ scopes: string[] }> }>;
  const scopes = catalog.find(tool => tool.name === "deployment.list")!.securitySchemes[0].scopes;
  expect(scopes).toContain("offline_access");
  const initial = await connect(scopes.join(" "));
  expect(initial.expires_in).toBe(3600);
  expect(initial.refresh_token).toBeTruthy();
  await expire(initial.access_token);
  expect((await call("deployment.list", initial.access_token)).status).toBe(401);
  const refresh = await exchange({ grant_type: "refresh_token", refresh_token: initial.refresh_token! });
  expect(refresh.status).toBe(200);
  expect(refresh.headers.get("Cache-Control")).toBe("no-store");
  const renewed = await refresh.json();
  expect(renewed.refresh_token).not.toBe(initial.refresh_token);
  expect(renewed.scope).toBe(initial.scope);
  const listing = await call("deployment.list", renewed.access_token);
  expect(listing.status).toBe(200);
  expect((await listing.json()).result.structuredContent.deployments.map((d: { id: number }) => d.id)).toEqual([approvedId]);
  const excluded = await call("deployment.inspect", renewed.access_token, { deployment: String(excludedId) });
  expect((await excluded.json()).result).toMatchObject({ isError: true });
  const grant = await state.db.oAuthGrant.findFirstOrThrow();
  expect(grant.resources).toBe(JSON.stringify([approvedId]));
  expect(grant.creationHosts).toBe("[]");
  expect((await exchange({ grant_type: "refresh_token", refresh_token: initial.refresh_token! })).status).toBe(400);
  await state.db.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  expect((await call("deployment.list", renewed.access_token)).status).toBe(401);
  expect((await exchange({ grant_type: "refresh_token", refresh_token: renewed.refresh_token })).status).toBe(400);
});

it("keeps an old short-lived grant working and requests renewable access only when reconnecting", async () => {
  const initial = await connect("deployment:read");
  expect(initial.refresh_token).toBeUndefined();
  expect((await call("deployment.list", initial.access_token)).status).toBe(200);
  await expire(initial.access_token);
  const expired = await call("deployment.list", initial.access_token);
  expect(expired.status).toBe(401);
  expect(expired.headers.get("WWW-Authenticate")).toContain('scope="deployment:read offline_access"');
  expect((await state.db.oAuthGrant.findFirstOrThrow()).scope).toBe("deployment:read");
  expect(await state.db.oAuthToken.count({ where: { kind: "refresh" } })).toBe(0);
});

it("offers the full first-deployment scope set on expired authentication without reserving anything", async () => {
  const response = await call("deployment.create");
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toContain('scope="deployment:create deployment:read deployment:redeploy operation:read offline_access"');
  expect(await state.db.agentOperation.count()).toBe(0);
});
