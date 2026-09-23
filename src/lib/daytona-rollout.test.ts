// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildGuardedRollout, snapshotReleaseEnvironment, restoreReleaseEnvironment } from "./daytona-rollout";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(failure: "none" | "pull" | "up" | "image" | "health" | "public" | "rollback") {
  const root = mkdtempSync(join(tmpdir(), "gc-rollout-")); dirs.push(root);
  const directory = `${root}/.groundcontrol/releases/release1`;
  mkdirSync(directory, { recursive: true }); mkdirSync(`${root}/bin`); mkdirSync(`${root}/lock`);
  for (const [file, contents] of Object.entries({ "previous.yml": "previous", "next.yml": "next", "next-override.yml": "next-images", "previous-images.yml": "previous-images", "previous-override.yml": "old-images", "override-existed": "" })) writeFileSync(`${directory}/${file}`, contents);
  writeFileSync(`${root}/.groundcontrol/compose.image.override.yml`, "old-images");
  const executable = (name: string, text: string) => writeFileSync(`${root}/bin/${name}`, `#!/bin/sh\n${text}`, { mode: 0o755 });
  executable("docker", `printf '%s\\n' "$*" >> "$GC_TEST_ROOT/calls"
case "$*" in
  pull*) [ "$GC_TEST_FAIL" != pull ] || exit 2;;
  *'up -d'*)
    case "$*" in *previous.yml*) echo old > "$GC_TEST_ROOT/state"; [ "$GC_TEST_FAIL" != rollback ] || exit 2;;
    *) echo new > "$GC_TEST_ROOT/state"; case "$GC_TEST_FAIL" in up|rollback) exit 2;; esac;; esac;;
  *'ps -q --all'*) echo container1;;
  *'image inspect'*) case "$*" in *ghcr*) echo new;; *) echo old;; esac;;
  *'{{.Image}}'*) if [ "$GC_TEST_FAIL" = image ] && [ "$(cat "$GC_TEST_ROOT/state")" = new ]; then echo wrong; else cat "$GC_TEST_ROOT/state"; fi;;
  *'{{.State.Status}}'*) echo running;;
  *'{{.State.ExitCode}}'*) echo 0;;
  *'State.Health'*) if [ "$GC_TEST_FAIL" = health ] && [ "$(cat "$GC_TEST_ROOT/state")" = new ]; then echo unhealthy; else echo healthy; fi;;
esac
exit 0`);
  executable("git", "exit 0"); executable("sleep", "exit 0");
  executable("curl", 'if [ "$GC_TEST_FAIL" = public ] && [ "$(cat "$GC_TEST_ROOT/state")" = new ]; then printf 503; else printf 200; fi');
  const script = buildGuardedRollout({ projectPath: root, directory, composeCommand: "docker compose", lockDirectory: `${root}/lock`, images: { web: `ghcr.io/acme/app@sha256:${"a".repeat(64)}` }, previousImages: { web: `sha256:${"b".repeat(64)}` }, oneShot: [], previousOneShot: [], services: ["web"], previousCommit: "c".repeat(40), checks: [{ id: "home", name: "Homepage", url: "https://example.com/", expectStatus: 200 }] });
  const result = spawnSync("sh", ["-c", script], { encoding: "utf8", env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, GC_TEST_ROOT: root, GC_TEST_FAIL: failure } });
  return { root, result, calls: readFileSync(`${root}/calls`, "utf8"), override: readFileSync(`${root}/.groundcontrol/compose.image.override.yml`, "utf8") };
}

describe("guarded release on a host", () => {
  it("restores prior environment bytes without printing them", () => {
    const root = mkdtempSync(join(tmpdir(), "gc-env-")); dirs.push(root);
    mkdirSync(`${root}/backup`); mkdirSync(`${root}/.groundcontrol`);
    writeFileSync(`${root}/.env`, "SECRET=before-$-release\n");
    const backup = spawnSync("sh", ["-c", snapshotReleaseEnvironment(`${root}/backup`)], { cwd: root, encoding: "utf8" });
    expect(backup.status).toBe(0);
    writeFileSync(`${root}/.env`, "SECRET=changed\n");
    writeFileSync(`${root}/.groundcontrol/compose.env.override.yml`, "new-overlay");
    const restore = spawnSync("sh", ["-c", restoreReleaseEnvironment(`${root}/backup`)], { cwd: root, encoding: "utf8" });
    expect(restore.status).toBe(0);
    expect(readFileSync(`${root}/.env`, "utf8")).toBe("SECRET=before-$-release\n");
    expect(existsSync(`${root}/.groundcontrol/compose.env.override.yml`)).toBe(false);
    expect(backup.stdout + restore.stdout).not.toContain("SECRET");
  });
  it("publishes success only after actual image, health and HTTPS checks", () => {
    const { result, root, calls, override } = fixture("none");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("__GC_REDEPLOY_STATUS__=success");
    expect(override).toBe("next-images");
    expect(calls).not.toMatch(/compose .*\bbuild\b(?! --)/); // up has --no-build, never a build command
    expect(existsSync(`${root}/lock`)).toBe(false);
  });
  it.each(["up", "image", "health", "public"] as const)("restores exact previous images after %s failure", failure => {
    const { result, calls, override, root } = fixture(failure);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("[rollback] Previous images and health verified");
    expect(result.stdout).not.toContain("__GC_REDEPLOY_STATUS__=success");
    expect(calls).toContain("previous-images.yml");
    expect(override).toBe("old-images");
    expect(readFileSync(`${root}/state`, "utf8").trim()).toBe("old");
  });
  it("leaves containers alone when pulling fails", () => {
    const { result, calls, override } = fixture("pull");
    expect(result.status).not.toBe(0);
    expect(calls).not.toContain("up -d");
    expect(override).toBe("old-images");
  });
  it("reports failed rollback instead of false recovery", () => {
    const { result } = fixture("rollback");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Rollback verification failed");
    expect(result.stdout).not.toContain("Previous images and health verified");
  });
});
