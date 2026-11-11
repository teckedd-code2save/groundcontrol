import { execFileSync } from "node:child_process";
import { it } from "vitest";

it("preserves installer encryption keys and fails closed on uncertain recovery", () => {
  execFileSync(process.execPath, ["--test", "scripts/check-install-key.cjs"], { stdio: "pipe" });
}, 30_000);
