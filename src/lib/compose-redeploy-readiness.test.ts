// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildRuntimeImageVerificationCommand } from "./compose-redeploy";

function verify(health: string, state = "running", exitCode = "0") {
  const dir = mkdtempSync(join(tmpdir(), "gc-readiness-"));
  try {
    const command = buildRuntimeImageVerificationCommand("docker compose", "/opt/app/compose.yml", { app: "registry/app:tested" }, 3);
    const result = spawnSync("sh", ["-c", `
docker() {
  if [ "$1" = compose ]; then
    case "$*" in
      *--all*) printf '%s' container;;
      *) [ "$STATE" != running ] || printf '%s' container;;
    esac
    return 0
  fi
  case "$3" in
    '{{.Config.Image}}') printf '%s' registry/app:tested;;
    '{{.State.Status}}') printf '%s' "$STATE";;
    '{{.State.ExitCode}}') printf '%s' "$EXIT_CODE";;
    *Health*)
      if [ "$HEALTH" = transitioning ]; then
        if [ -f "$TRACE" ]; then printf '%s' healthy; else printf '%s' starting; fi
      else printf '%s' "$HEALTH"; fi;;
  esac
}
sleep() { printf '%s\\n' wait >> "$TRACE"; }
${command}
`], { encoding: "utf8", env: { ...process.env, HEALTH: health, STATE: state, EXIT_CODE: exitCode, TRACE: join(dir, "waits") } });
    let waits = "";
    try { waits = readFileSync(join(dir, "waits"), "utf8"); } catch { /* No wait needed. */ }
    return { ...result, waits };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

it("waits for the app health check before allowing public endpoint verification", () => {
  const result = verify("transitioning");
  expect(result.status).toBe(0);
  expect(result.waits).toBe("wait\n");
  expect(result.stdout).toContain("health healthy");
});

it.each(["starting", "unhealthy"])("rejects a running app whose health remains %s", health => {
  const result = verify(health);
  expect(result.status).toBe(42);
  expect(result.stdout).toContain(`error=container health not ready health=${health}`);
});

it("preserves services without health checks and successful migration jobs", () => {
  expect(verify("none").status).toBe(0);
  expect(verify("none", "exited").status).toBe(0);
  expect(verify("none", "exited", "1").status).toBe(42);
});
