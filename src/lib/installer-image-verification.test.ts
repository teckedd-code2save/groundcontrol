// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
const source = readFileSync("scripts/install", "utf8");
const functions = source.slice(source.indexOf("assert_canonical_compose_inputs()"), source.indexOf("\nimage_repo_digest()"));
function run(command: string, files: Record<string, string> = {}, extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "gc-upgrade-image-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  try {
    const result = spawnSync("bash", ["-c", `set -eu\nfail() { printf '%s\\n' "$*" >&2; exit 1; }\nlog() { printf '%s\\n' "$*"; }\ncontainer_health() { printf '%s' healthy; }\ndocker() { if [ "$1" = image ]; then printf '%s' "$EXPECTED"; else printf '%s' "$ACTUAL"; fi; }\n${functions}\n${command}`], {
      encoding: "utf8", env: { ...process.env, COMPOSE_FILE: "", INSTALL_DIR: root, EXPECTED: "sha256:target", ACTUAL: "sha256:target", ...extra },
    });
    for (const [name, content] of Object.entries(files)) expect(readFileSync(join(root, name), "utf8")).toBe(content);
    return result;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
it.each(["compose.yml", "compose.yaml", "compose.override.yml", "docker-compose.override.yml", "docker-compose.override.yaml"])("refuses implicit %s without changing it", file => {
  const result = run("assert_canonical_compose_inputs", { [file]: "services:\n  web:\n    image: old-image\n" });
  expect(result.status).not.toBe(0); expect(result.stderr).toContain("file was preserved");
});
it("refuses Compose input overrides from the environment and dotenv", () => {
  expect(run("assert_canonical_compose_inputs", {}, { COMPOSE_FILE: "other.yml" }).status).not.toBe(0);
  expect(run("assert_canonical_compose_inputs", { ".env": "COMPOSE_FILE=other.yml\n" }).status).not.toBe(0);
  expect(run("assert_canonical_compose_inputs", { "docker-compose.yml": "services: {}", ".env": "HOST_PORT=3003\n" }).status).toBe(0);
});
it("rejects a healthy container with the wrong image and accepts only the exact image", () => {
  const mismatch = run("wait_healthy 1 expected-ref", {}, { ACTUAL: "sha256:old" });
  expect(mismatch.status).not.toBe(0); expect(mismatch.stdout).toContain("does not match");
  expect(run("wait_healthy 1 expected-ref").status).toBe(0);
  expect(run("wait_healthy 1 expected-ref", {}, { ACTUAL: "", EXPECTED: "" }).status).not.toBe(0);
});
