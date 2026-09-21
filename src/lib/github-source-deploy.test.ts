// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildGithubSourceSyncCommand, normalizeSourceBranch } from "./github-source-deploy";

describe("GitHub source deploy", () => {
  it("accepts normal branch names and rejects unsafe refs", () => {
    expect(normalizeSourceBranch("feature/direct-deploy")).toBe("feature/direct-deploy");
    expect(normalizeSourceBranch("", "main")).toBe("main");
    expect(() => normalizeSourceBranch("../main")).toThrow();
    expect(() => normalizeSourceBranch("feature@{1}")).toThrow();
    expect(() => normalizeSourceBranch("-main")).toThrow();
  });

  it("uses a temporary askpass helper without embedding credentials in the command", () => {
    const command = buildGithubSourceSyncCommand({
      projectPath: "/srv/groundcontrol/deployments/rentaweekend",
      repository: "teckedd-code2save/RentAWeekend",
      branch: "main",
    });
    expect(command).toContain("GIT_ASKPASS");
    expect(command).toContain("IFS= read -r GC_GITHUB_TOKEN");
    expect(command).toContain("https://github.com/teckedd-code2save/RentAWeekend.git");
    expect(command).not.toContain("github_pat_");
    expect(command).not.toContain("git clean");
  });
});
