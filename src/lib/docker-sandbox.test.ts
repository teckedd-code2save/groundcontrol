// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildSandboxBuildScript,
  buildSandboxCloneScript,
  buildSbxCreateCommand,
  buildSbxExecCommand,
  buildSbxRmCommand,
  parseSandboxId,
} from "./docker-sandbox";

const SHA = "a".repeat(40);

describe("docker-sandbox", () => {
  it("creates an amd64 cloud sandbox", () => {
    const cmd = buildSbxCreateCommand("gc-build-abc12345");
    expect(cmd).toContain("sbx --cloud create shell");
    expect(cmd).toContain("--platform linux/amd64");
    expect(cmd).toContain("--name 'gc-build-abc12345'");
  });

  it("execs a script inside the sandbox", () => {
    const cmd = buildSbxExecCommand("sbx_abc", "docker build .");
    expect(cmd).toContain("sbx --cloud exec 'sbx_abc' sh -c");
    expect(cmd).toContain("docker build .");
  });

  it("removes the sandbox forcefully", () => {
    expect(buildSbxRmCommand("sbx_abc")).toContain("sbx --cloud rm --force 'sbx_abc'");
  });

  it("builds a clone script that reads the git token and checks out @SHA", () => {
    const script = buildSandboxCloneScript({
      repoUrl: "https://github.com/org/app.git",
      commitSha: SHA,
    });
    expect(script).toContain("IFS= read -r GC_GIT_TOKEN");
    expect(script).toContain("git clone \"https://x-access-token:$GC_GIT_TOKEN@github.com/org/app.git\" /tmp/repo");
    expect(script).toContain("git checkout " + SHA);
    expect(script).toContain('test "$(git rev-parse HEAD)" = "' + SHA + '"');
    // clone phase must not build or push.
    expect(script).not.toContain("docker build");
    expect(script).not.toContain("docker push");
  });

  it("builds the login-build-push-inspect script from the repo root", () => {
    const script = buildSandboxBuildScript({
      ref: "ghcr.io/org/app:" + SHA,
      username: "teckedd-code2save",
    });
    expect(script).toContain("IFS= read -r GC_GHCR_TOKEN");
    expect(script).toContain("docker login 'ghcr.io' -u 'teckedd-code2save' --password-stdin");
    expect(script).toContain("docker build -t 'ghcr.io/org/app:" + SHA + "' '.'");
    expect(script).toContain("docker push 'ghcr.io/org/app:" + SHA + "'");
    expect(script).toContain("RepoDigests");
    // build phase must not clone.
    expect(script).not.toContain("git clone");
  });

  it("anchors a non-default dockerfile to the build context", () => {
    const script = buildSandboxBuildScript({
      ref: "ghcr.io/org/app:" + SHA,
      username: "u",
      context: "rentweekend-backend",
      dockerfile: "Dockerfile.prod",
    });
    expect(script).toContain(
      "docker build -t 'ghcr.io/org/app:" + SHA + "' -f 'rentweekend-backend/Dockerfile.prod' 'rentweekend-backend'"
    );
  });

  it("parses a sandbox id from create output", () => {
    const output = "✓ Created sandbox shell/gc-amd64-probe (sbx_001m51cgg5qyacjmk26pj892qg5, image docker/sandbox-templates:shell-docker)";
    expect(parseSandboxId(output)).toBe("sbx_001m51cgg5qyacjmk26pj892qg5");
    expect(parseSandboxId("no sandbox here")).toBeNull();
  });
});
