// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildBuildkitBuildPushCommand, buildEnsureBuildkitBuilderCommand } from "./github-image-release";
import { captureCommand } from "./command-output";
import { buildOutput, buildFailureSummary } from "./build-output";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function harness(failure = "") {
  const dir = mkdtempSync(join(tmpdir(), "gc-build-test-")); dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin/docker"), `#!/bin/sh
set -eu
[ "$DOCKER_CONFIG" = "$HOME/.groundcontrol/docker" ] || exit 90
printf '%s\\n' "$*" >> "$HOME/calls"
case "$*" in
  'buildx inspect gc-proof') test -f "$HOME/builder" ;;
  'buildx create '*) touch "$HOME/builder" ;;
  'buildx bake '*)
    case "$*" in *"--push api web") ;; *) exit 91;; esac
    [ "${failure}" != build ] || { echo COMPILE_FAILED >&2; exit 17; }
    [ "${failure}" != push ] || { echo REGISTRY_DENIED >&2; exit 23; }
    ;;
esac
`, { mode: 0o755 });
  const run = (command: string) => spawnSync("/bin/sh", ["-c", command], {
    env: { ...process.env, HOME: dir, PATH: `${dir}/bin:${process.env.PATH}` }, encoding: "utf8",
  });
  const command = buildBuildkitBuildPushCommand({ projectPath: dir, composeFile: `${dir}/compose.yml`, builder: "gc-proof", refs: { api: `ghcr.io/org/api:${"a".repeat(40)}`, web: `ghcr.io/org/web:${"a".repeat(40)}` } });
  return { dir, run, command, calls: () => readFileSync(join(dir, "calls"), "utf8") };
}

describe("build and publish execution", () => {
  it("bootstraps and publishes only selected services with the same registry configuration", () => {
    const h = harness();
    expect(h.run(buildEnsureBuildkitBuilderCommand("gc-proof", "2", "2g")).status).toBe(0);
    expect(h.run(h.command).status).toBe(0);
    expect(h.calls()).toContain("--push api web");
    expect(h.calls()).not.toContain("worker");
    expect(h.calls().match(/pull --platform/g)).toHaveLength(2);
  });
  for (const [failure, code, message] of [["build", 17, "COMPILE_FAILED"], ["push", 23, "REGISTRY_DENIED"]] as const) {
    it(`preserves ${failure} failure and never continues to pull or verification`, () => {
      const h = harness(failure);
      const result = h.run(h.command);
      expect(result.status).toBe(code);
      expect(result.stderr).toContain(message);
      expect(h.calls()).not.toContain("pull");
    });
  }
  it("retains both complete streams beyond exec's old buffer limit and the final error", async () => {
    const script = `node -e 'process.stdout.write("o".repeat(2200000));process.stderr.write("e".repeat(2200000)+"FINAL_FAILURE");process.exitCode=17'`;
    const error = await captureCommand(script).catch((error) => error);
    const log = buildOutput("build", error);
    expect(log.code).toBe(17);
    expect(log.stdout).toHaveLength(2200000);
    expect(log.stderr).toHaveLength(2200013);
    expect(buildFailureSummary(log)).toContain("FINAL_FAILURE");
  });
  it("redacts credentials without losing surrounding evidence", () => {
    const log = buildOutput("publish", { code: 1, stdout: "START\n", stderr: "ghp_abc123 Bearer abc123 https://u:pw@example.com password=abc\nFINAL" });
    expect(log.stderr).not.toMatch(/abc123|u:pw|password=abc/);
    expect(log.stdout).toBe("START\n");
    expect(log.stderr).toContain("FINAL");
  });
  it("reports a killed command as a failure rather than success", async () => {
    await expect(captureCommand("sleep 10", { timeout: 30 })).rejects.toMatchObject({ code: 124 });
  });
});
