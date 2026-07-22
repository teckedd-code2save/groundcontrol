import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManagedComposeInvocation } from "./vps";

describe("managed Docker Compose invocation", () => {
  it("uses GroundControl's isolated Docker credentials", () => {
    const command = buildManagedComposeInvocation("docker compose", "pull");
    expect(command).toContain('DOCKER_CONFIG="${HOME}/.groundcontrol/docker"');
    expect(command).toContain('docker compose "$@" pull');
    expect(command).toContain(".groundcontrol/compose.image.override.yml");
    expect(command).toContain(".groundcontrol/compose.env.override.yml");
    expect(command).toContain(".groundcontrol/compose.env.files");
    expect(command).toContain("exit 46");
  });

  it("keeps an explicit compose file and managed override behaviour", () => {
    const command = buildManagedComposeInvocation("docker compose", "up -d", "compose.prod.yml");
    expect(command).toContain("compose.prod.yml");
    expect(command).toContain("compose.image.override.yml");
    expect(command).toContain(".groundcontrol/compose.env.override.yml");
    expect(command).toContain('DOCKER_CONFIG="${HOME}/.groundcontrol/docker"');
    expect(spawnSync("sh", ["-n"], { input: command }).status).toBe(0);
  });

  it("can validate image configuration without requiring runtime env files", () => {
    const command = buildManagedComposeInvocation(
      "docker compose",
      "config --quiet",
      "compose.yml",
      { includeEnvironment: false }
    );
    expect(command).toContain("compose.image.override.yml");
    expect(command).not.toContain("compose.env.override.yml");
    expect(command).not.toContain("compose.env.files");
    expect(spawnSync("sh", ["-n"], { input: command }).status).toBe(0);
  });

  it("refuses a stale managed environment instead of silently deploying without secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "gc-compose-env-"));
    try {
      mkdirSync(join(directory, ".groundcontrol"));
      writeFileSync(join(directory, ".groundcontrol/compose.env.override.yml"), "services: {}\n");
      const command = buildManagedComposeInvocation("true", "", "compose.yml");
      const result = spawnSync("sh", ["-c", command], { cwd: directory, encoding: "utf8" });

      expect(result.status).toBe(46);
      expect(result.stderr).toContain("managed environment is not materialized");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
