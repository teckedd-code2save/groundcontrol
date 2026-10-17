// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildSandboxBuildScript,
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

  it("builds the clone-checkout-build-push-inspect script", () => {
    const script = buildSandboxBuildScript({
      repoUrl: "https://github.com/org/app.git",
      commitSha: SHA,
      ref: `ghcr.io/org/app:${SHA}`,
    });
    expect(script).toContain("git clone 'https://github.com/org/app.git' /tmp/repo");
    expect(script).toContain(`git checkout ${SHA}`);
    expect(script).toContain(`docker build -t 'ghcr.io/org/app:${SHA}' .`);
    expect(script).toContain(`docker push 'ghcr.io/org/app:${SHA}'`);
    expect(script).toContain("RepoDigests");
  });

  it("parses a sandbox id from create output", () => {
    const output = "✓ Created sandbox shell/gc-amd64-probe (sbx_001m51cgg5qyacjmk26pj892qg5, image docker/sandbox-templates:shell-docker)";
    expect(parseSandboxId(output)).toBe("sbx_001m51cgg5qyacjmk26pj892qg5");
    expect(parseSandboxId("no sandbox here")).toBeNull();
  });
});
