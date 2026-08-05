import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, DeploymentTarget, Deployment } from "@prisma/client";
import type { DeployContext } from "./types";

/**
 * Compose deploy target: rollback digest pinning.
 * All remote work goes through execOnVps() from @/lib/vps, which is mocked
 * here while the real shQuote/buildManagedComposeInvocation stay in place so
 * the generated commands are locked down exactly as they run on a VPS.
 */

const { execOnVpsMock, getDockerComposeCommandMock, resolveComposeProjectPathMock } =
  vi.hoisted(() => ({
    execOnVpsMock: vi.fn(),
    getDockerComposeCommandMock: vi.fn(),
    resolveComposeProjectPathMock: vi.fn(),
  }));

vi.mock("@/lib/vps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vps")>();
  return {
    ...actual,
    execOnVps: execOnVpsMock,
    getDockerComposeCommand: getDockerComposeCommandMock,
    resolveComposeProjectPath: resolveComposeProjectPathMock,
  };
});

import { createComposeTarget } from "./compose";

const DIGEST =
  "ghcr.io/org/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OVERRIDE_PATH = "/opt/test-project/.groundcontrol/compose.image.override.yml";

const mockProject = {
  id: 1,
  slug: "test-project",
  name: "Test Project",
  repoUrl: null,
  path: "/opt/test-project",
  dockerfile: null,
  buildCommand: null,
  outputDir: null,
  domain: null,
  envVars: null,
  caddyFile: null,
  dockerCompose: null,
  category: "static",
  status: "unknown",
  lastDeploy: null,
  projectGroupId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Project;

const mockTarget = (configJson: string = "{}"): DeploymentTarget => ({
  id: 1,
  name: "test-target",
  type: "compose",
  vpsConfigId: null,
  cloudProviderAccountId: null,
  configJson,
  isActive: false,
  dnsRecordId: null,
  dnsRecordName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function makeCtx(): DeployContext {
  return { vps: null, env: {}, secrets: {}, log: vi.fn() };
}

function commands(): string[] {
  return execOnVpsMock.mock.calls.map((call) => String(call[0]));
}

function stdinOf(callIndex: number): string {
  return String(execOnVpsMock.mock.calls[callIndex]?.[3] ?? "");
}

beforeEach(() => {
  execOnVpsMock.mockReset();
  execOnVpsMock.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
  getDockerComposeCommandMock.mockResolvedValue("docker compose");
  resolveComposeProjectPathMock.mockResolvedValue({
    projectPath: "/opt/test-project",
    projectSlug: "test-project",
    source: "labels",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("compose target rollback", () => {
  it("pins the previous image digest for the first service via the managed image override", async () => {
    // config --services → web
    execOnVpsMock.mockResolvedValueOnce({ stdout: "web\n", stderr: "", code: 0 });
    // cat of the existing override → none (no pre-existing user pin)
    execOnVpsMock.mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 });

    const target = createComposeTarget(mockProject, mockTarget());
    await target.rollback(
      { previousImageDigest: DIGEST } as unknown as Deployment,
      makeCtx()
    );

    const cmds = commands();
    // 1) Resolve the real service names — never a wildcard key.
    expect(cmds[0]).toContain("config --services");
    // 2) Read any pre-existing managed image override so it can be restored.
    expect(cmds[1]).toContain(`cat '${OVERRIDE_PATH}' 2>/dev/null || true`);
    // 3) Write the pin override via stdin (no shell-escaped YAML).
    expect(cmds[2]).toContain(`cat > '${OVERRIDE_PATH}'`);
    const pin = stdinOf(2);
    expect(pin).toContain("web:");
    expect(pin).toContain(DIGEST);
    expect(pin).not.toContain('"*"');
    // 4) down + up ride the managed invocation so the override is applied
    //    (same DOCKER_CONFIG isolation and env overlay as normal deploys).
    expect(cmds[3]).toContain("down");
    expect(cmds[3]).toContain("up -d");
    // 5) The temporary pin is removed afterwards.
    expect(cmds[4]).toContain(`rm -f '${OVERRIDE_PATH}'`);
  });

  it("restarts the stack when no previous digest is stored", async () => {
    const target = createComposeTarget(mockProject, mockTarget());
    await target.rollback(
      { previousImageDigest: null } as unknown as Deployment,
      makeCtx()
    );

    const cmds = commands();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toContain("down");
    expect(cmds[0]).toContain("up -d");
    expect(cmds.join("\n")).not.toContain("config --services");
    // No override is written or deleted on the restart path.
    expect(cmds.join("\n")).not.toContain(`cat > '${OVERRIDE_PATH}'`);
    expect(cmds.join("\n")).not.toContain(`rm -f '${OVERRIDE_PATH}'`);
  });

  it("falls back to restart when compose services cannot be resolved", async () => {
    execOnVpsMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "no compose file found",
      code: 1,
    });

    const target = createComposeTarget(mockProject, mockTarget());
    await target.rollback(
      { previousImageDigest: DIGEST } as unknown as Deployment,
      makeCtx()
    );

    const cmds = commands();
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toContain("config --services");
    expect(cmds[1]).toContain("up -d");
    // No override is written or deleted on the fallback path.
    expect(cmds.join("\n")).not.toContain(`cat > '${OVERRIDE_PATH}'`);
    expect(cmds.join("\n")).not.toContain(`rm -f '${OVERRIDE_PATH}'`);
  });

  it("pins only the first service when the stack has multiple services", async () => {
    execOnVpsMock.mockResolvedValueOnce({
      stdout: "web\nworker\n",
      stderr: "",
      code: 0,
    });
    execOnVpsMock.mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 });

    const target = createComposeTarget(mockProject, mockTarget());
    await target.rollback(
      { previousImageDigest: DIGEST } as unknown as Deployment,
      makeCtx()
    );

    const pin = stdinOf(2);
    expect(pin).toContain("web:");
    expect(pin).not.toContain("worker:");
  });

  it("restores a pre-existing user image pin after rollback", async () => {
    const userPin = "services:\n  web:\n    image: ghcr.io/org/app:v2\n";
    execOnVpsMock.mockResolvedValueOnce({ stdout: "web\n", stderr: "", code: 0 });
    execOnVpsMock.mockResolvedValueOnce({ stdout: userPin, stderr: "", code: 0 });

    const target = createComposeTarget(mockProject, mockTarget());
    await target.rollback(
      { previousImageDigest: DIGEST } as unknown as Deployment,
      makeCtx()
    );

    const cmds = commands();
    // The rollback pin is merged into the managed override for the rollback…
    expect(stdinOf(2)).toContain(DIGEST);
    // …and the user's own pin is written back afterwards (last call via stdin).
    const last = cmds.length - 1;
    expect(cmds[last]).toContain(`cat > '${OVERRIDE_PATH}'`);
    expect(stdinOf(last)).toContain("ghcr.io/org/app:v2");
    expect(stdinOf(last)).not.toContain("aaaaaaaa");
  });
});
