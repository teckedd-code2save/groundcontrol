// @vitest-environment node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Exercise the standalone launcher's own helpers, not a duplicate implementation.
const helpers = readFileSync("scripts/start", "utf8").split("\nfail() {")[0];
function render(command: string, env: Partial<NodeJS.ProcessEnv> = {}, tty = false) {
  const result = spawnSync("bash", ["-c", `${helpers}\nui_tty() { ${tty ? "return 0" : "return 1"}; }\n${command}`], {
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, TERM: "xterm-256color", ...env },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}
const url = "https://fixture.trycloudflare.com/claim#token=gc_claim_fixture_only";

describe("installer terminal presentation", () => {
  it("keeps redirected output plain and the complete URL copyable", () => {
    const output = render(`ui_step 3 'Open GroundControl'; ui_link '${url}'`, { TERM_PROGRAM: "iTerm.app" });
    expect(output).toContain("[3/3] Open GroundControl");
    expect(output).toContain(url);
    expect(output).not.toContain("\x1b");
    expect(output).not.toContain("Cmd-click");
  });
  it.each(["iTerm.app", "WezTerm", "vscode", "ghostty"])("uses an OSC 8 link in %s", (program) => {
    const output = render(`ui_link '${url}'`, { TERM_PROGRAM: program }, true);
    expect(output).toContain(`\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`);
    expect(output).toContain("or copy the link");
  });
  it("uses Apple Terminal's native clickable URL rather than unsupported escape sequences", () => {
    const output = render(`ui_link '${url}'`, { TERM_PROGRAM: "Apple_Terminal" }, true);
    expect(output).toContain(url);
    expect(output).toContain("Cmd-click on Mac");
    expect(output).not.toContain("\x1b");
  });
  it("falls back safely for unknown terminals and supports disabling hyperlinks", () => {
    expect(render(`ui_link '${url}'`, {}, true)).not.toContain("\x1b");
    expect(render(`ui_link '${url}'`, { TERM_PROGRAM: "iTerm.app", GC_TERMINAL_LINKS: "0" }, true)).not.toContain("\x1b");
  });
  it("respects NO_COLOR without losing the heading or step number", () => {
    const plain = render("ui_step 2 'Prepare GroundControl and access'", { NO_COLOR: "" }, true);
    expect(plain).toBe("\n[2/3] Prepare GroundControl and access\n");
    expect(render("ui_step 2 'Prepare GroundControl and access'", {}, true)).toContain("\x1b[1;36m");
  });
  it("does not decorate dumb-terminal output", () => {
    const result = spawnSync("bash", ["-c", `${helpers}\nui_step 3 'Open GroundControl'; ui_link '${url}'`], {
      encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, TERM: "dumb", TERM_PROGRAM: "iTerm.app" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("\x1b");
  });
});
