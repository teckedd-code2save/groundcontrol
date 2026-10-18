// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { execute, auth } = vi.hoisted(() => ({ execute: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: auth }));
vi.mock("@/lib/host-exec", () => ({ execOnTargetStrict: execute }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findFirst: async () => ({ id: 1 }) }, enrolledDeployment: { findFirst: async () => ({ id: 2, managementMode: "managed" }) } } }));
vi.mock("@/lib/github-registry", () => ({ ensureGithubRegistryLogin: async () => ({ configured: true }) }));
vi.mock("@/lib/github-source-deploy", () => ({ syncGithubDeploymentSource: async () => ({ commitSha: "a".repeat(40) }) }));
vi.mock("@/lib/vps", async (original) => ({ ...await original<object>(), getActiveVps: async () => ({ isLocal: true }), resolveComposeProjectPath: async () => ({ projectPath: "/opt/proof" }), resolveComposeFile: async () => "/opt/proof/compose.yml", getDockerComposeCommand: async () => "docker compose" }));
import { POST } from "./route";
const sha = "a".repeat(40);
const digest = "b".repeat(64);
const request = (runTests = false) => new NextRequest("http://localhost/api/projects/compose/build-publish", { method: "POST", body: JSON.stringify({ projectSlug: "proof", commitSha: sha, builder: "buildkit", services: ["api", "web"], runTests, testCommand: "test -f /proof" }) });

beforeEach(() => {
  auth.mockReset(); execute.mockReset();
  execute.mockImplementation(async (command: string) => {
    if (command.includes('"$@" config')) return { code: 0, stdout: "services:\n  api:\n    build: .\n    image: ghcr.io/org/api:old\n    environment:\n      PASSWORD: keep-private\n  web:\n    build: .\n    image: ghcr.io/org/web:old\n", stderr: "" };
    if (command.includes("gc_digest=")) return { code: 0, stdout: ["api", "web"].map((s) => `service=${s} ref=ghcr.io/org/${s}:${sha} digest=ghcr.io/org/${s}@sha256:${digest} arch=amd64`).join("\n"), stderr: "" };
    return { code: 0, stdout: "ok", stderr: "" };
  });
});

it("returns full build failure evidence and restores the prior configuration", async () => {
  const normal = execute.getMockImplementation()!;
  execute.mockImplementation(async (...args) => String(args[0]).includes("buildx bake")
    ? { code: 23, stdout: "start\n" + "x".repeat(50000), stderr: "tail\nREGISTRY_DENIED" } : normal(...args));
  const response = await POST(request());
  const body = await response.json();
  expect(response.status).toBe(400);
  expect(body.error).toContain("REGISTRY_DENIED");
  expect(body.logs.find((log: { phase: string }) => log.phase === "build and publish").stdout).toHaveLength(50006);
  expect(JSON.stringify(body)).not.toContain("keep-private");
  expect(execute.mock.calls.at(-1)?.[0]).toContain("compose.image.override.yml");
  expect(execute.mock.calls.some(([command]) => command.includes("gc_digest="))).toBe(false);
});

it("tests both published images and retains stdout and stderr for each", async () => {
  const normal = execute.getMockImplementation()!;
  execute.mockImplementation(async (...args) => String(args[0]).includes("docker run --rm")
    ? { code: String(args[0]).includes("/web:") ? 7 : 0, stdout: "TEST_START", stderr: "TEST_END" } : normal(...args));
  const response = await POST(request(true));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.tests.status).toBe("failed");
  expect(body.tests.results).toHaveLength(2);
  expect(body.tests.output).toContain("TEST_START");
  expect(body.tests.output).toContain("TEST_END");
});

it("does not execute host commands for an unauthenticated caller", async () => {
  auth.mockImplementation(() => { throw new Error("Unauthorized"); });
  expect((await POST(request())).status).toBe(401);
  expect(execute).not.toHaveBeenCalled();
});
