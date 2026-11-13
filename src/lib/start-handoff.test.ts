// @vitest-environment node
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function run(result: object, args: string[] = [], installerFails = false) {
  const dir = mkdtempSync(join(tmpdir(), "gc-handoff-test-"));
  const log = join(dir, "calls");
  const fixture = join(dir, "result");
  writeFileSync(fixture, JSON.stringify(result));
  writeFileSync(join(dir, "ssh"), `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  *"sh -s --"*) cat >/dev/null; [ "$FAIL_INSTALL" != 1 ] || exit 1; cat "$RESULT_FILE" ;;
  *"-O check"*) exit 1 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(dir, "curl"), '#!/bin/bash\nprintf "curl %s\\n" "$*" >> "$CALLS"\n', { mode: 0o755 });
  try {
    const child = spawnSync("bash", ["scripts/start", "--remote", "test@server", ...args], {
      cwd: process.cwd(), encoding: "utf8", timeout: 5000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: log, RESULT_FILE: fixture, FAIL_INSTALL: installerFails ? "1" : "0" },
    });
    return { status: child.status, stdout: child.stdout, stderr: child.stderr, calls: readFileSync(log, "utf8") };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const fresh = { stage: "claim_required", claimToken: "gc_claim_test_only", hostPort: 3003, publicUrl: "https://test.trycloudflare.com", accessMode: "quick_tunnel" };

describe("remote installer HTTPS handoff", () => {
  it("hands off a fragment-only claim and exits without creating a local forward", () => {
    const r = run(fresh);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("https://test.trycloudflare.com/claim#token=gc_claim_test_only");
    expect(r.stdout).toContain("Temporary access: configure a permanent domain");
    expect(r.stdout).toContain("You can close this terminal");
    expect(r.calls).not.toContain("-O forward");
    expect(r.calls).not.toContain("gc_claim_test_only");
    expect(r.calls).toContain("-O exit");
  });
  it("returns the existing permanent login without describing it as temporary", () => {
    const r = run({ ...fresh, stage: "already_claimed", publicUrl: "https://gc.example.com", accessMode: "cloudflare_tunnel" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("https://gc.example.com/login");
    expect(r.stdout).not.toContain("/claim#");
    expect(r.stdout).not.toContain("Temporary access:");
  });
  it.each(["http://gc.example.com", "https://gc.example.com/path", "https://user:pass@gc.example.com", ""])('rejects an unusable public origin: %s', (publicUrl) => {
    const r = run({ ...fresh, publicUrl });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--private");
    expect(r.stdout).not.toContain("gc_claim_test_only");
    expect(r.calls).not.toContain("-O forward");
  });
  it("preserves explicit private forwarding and passes private choice to the installer", () => {
    const r = run(fresh, ["--private"]);
    expect(r.stdout).toContain("http://127.0.0.1:3003/claim#token=");
    expect(r.stdout).toContain("Keep this terminal open");
    expect(r.calls).toContain("-O forward");
    expect(r.calls).toContain("'main' '1'");
    expect(r.calls).toContain("-O exit");
  });
  it("honors saved private-only mode on a default rerun", () => {
    const r = run({ ...fresh, stage: "already_claimed", publicUrl: "", accessMode: "private" });
    expect(r.stdout).toContain("Your saved private-only choice is preserved");
    expect(r.stdout).toContain("http://127.0.0.1:3003/login");
    expect(r.calls).toContain("-O forward");
  });
  it("does not hand off a misleading link after installer failure", () => {
    const r = run(fresh, [], true);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("/claim#");
    expect(r.calls).toContain("-O exit");
  });
});
