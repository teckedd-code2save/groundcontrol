// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ calls: [] as string[], fail: "", create: vi.fn(), remove: vi.fn(), dispose: vi.fn() }));
vi.mock("@daytona/sdk", () => ({ Daytona: class {
  create = state.create; delete = state.remove; [Symbol.asyncDispose] = state.dispose;
} }));
vi.mock("./intelligence/daytona", () => ({ loadDaytonaRuntimeConfig: async () => ({ apiKey: "daytona-secret" }) }));
vi.mock("./github-source-deploy", () => ({
  sourceAccessForDeployment: async () => ({ token: "github-source-secret", repository: { fullName: "acme/app", defaultBranch: "main" } }),
  normalizeSourceBranch: (branch: string) => branch || "main",
}));
vi.mock("./github-registry", () => ({ loadGithubRegistryPublishCredential: async () => ({ username: "user", token: "registry-secret" }) }));
import { buildDaytonaRelease } from "./daytona-release";
import { parseReleaseBuildPolicy } from "./daytona-release-plan";
const sha = "a".repeat(40);
const digest = `ghcr.io/acme/app-web@sha256:${"b".repeat(64)}`;
const logs: string[] = [];
const run = () => buildDaytonaRelease({ deploymentId: 1, commitSha: sha, composePath: "compose.yml", policy: parseReleaseBuildPolicy({ provider: "daytona", imagePrefix: "ghcr.io/acme/app" }), evidence: async line => { logs.push(line); } });
beforeEach(() => {
  vi.clearAllMocks(); state.calls.length = 0; state.fail = ""; logs.length = 0;
  state.remove.mockImplementation(async () => { state.calls.push("delete"); if (state.fail === "cleanup") throw new Error("cleanup"); });
  state.dispose.mockResolvedValue(undefined);
  state.create.mockImplementation(async () => ({ id: "sandbox1", cpu: 2, memory: 4, disk: 10,
    fs: { uploadFile: async (_data: Buffer, path: string) => { state.calls.push(`upload ${path}`); } },
    process: { executeCommand: async (command: string) => {
      state.calls.push(command);
      if (state.fail === "build" && command.includes("docker build ")) return { exitCode: 1, result: "build failed registry-secret daytona-secret github-source-secret" };
      if (state.fail === "push" && command.includes("docker push ")) return { exitCode: 1, result: "permission denied registry-secret" };
      return { exitCode: 0, result: command.includes("RepoDigests") ? JSON.stringify([digest]) : "ok" };
    } },
  }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/commits/")) return new Response(JSON.stringify({ sha }));
    if (url.includes("/contents/")) return new Response(JSON.stringify({ encoding: "base64", content: Buffer.from("services:\n  web:\n    build: .\n").toString("base64") }));
    return new Response("source-archive");
  }));
});
describe("isolated release builder", () => {
  it("publishes immutable digests, injects registry credentials after build, and confirms deletion", async () => {
    const result = await run();
    expect(result.images).toEqual({ web: digest }); expect(result.cleanedUp).toBe(true);
    const buildIndex = state.calls.findIndex(line => line.includes("docker build "));
    const authIndex = state.calls.findIndex(line => line.includes("upload /tmp/gc-registry/config.json"));
    expect(authIndex).toBeGreaterThan(buildIndex);
    expect(state.calls.at(-1)).toBe("delete");
    expect(state.create.mock.calls[0][0]).toMatchObject({ resources: { cpu: 2, memory: 4, disk: 10 }, ttlMinutes: 18 });
    expect(state.calls.join("\n")).not.toContain("github-source-secret");
  });
  it("deletes a failed build without sending registry credentials", async () => {
    state.fail = "build";
    await expect(run()).rejects.toThrow("[REDACTED]");
    expect(state.calls.join("\n")).not.toContain("upload /tmp/gc-registry/config.json");
    expect(state.remove).toHaveBeenCalledOnce();
    expect(logs.join("\n")).not.toMatch(/registry-secret|daytona-secret|github-source-secret/);
  });
  it("rejects publish failures and still deletes the sandbox", async () => {
    state.fail = "push";
    await expect(run()).rejects.toThrow("permission denied [REDACTED]");
    expect(state.remove).toHaveBeenCalledOnce();
  });
  it("blocks deployment when sandbox cleanup is unconfirmed", async () => {
    state.fail = "cleanup";
    await expect(run()).rejects.toThrow("Production replacement is blocked");
    expect(state.dispose).toHaveBeenCalledOnce();
  });
});
