// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { planDaytonaImages, parseReleaseBuildPolicy, repositoryPath, redactBuildEvidence, imageBuildCommand } from "./daytona-release-plan";
import { buildGithubSourceSyncCommand } from "./github-source-deploy";
const commitSha = "a".repeat(40);
const policy = parseReleaseBuildPolicy({ provider: "daytona", imagePrefix: "ghcr.io/acme/app" });
const plan = (compose: string) => planDaytonaImages({ compose, composePath: "deploy/compose.yml", policy, commitSha });

describe("Daytona source boundary", () => {
  it("builds repository paths without interpolating runtime values", () => {
    const [build] = plan("services:\n  web:\n    image: ${SECRET}\n    environment:\n      SECRET: ${SECRET}\n    build:\n      context: ../frontend\n      target: production\n  db:\n    image: postgres:16\n");
    expect(build.context).toBe("frontend");
    expect(build.tag).toBe(`ghcr.io/acme/app-web:${commitSha}`);
    expect(imageBuildCommand(build, "acme/app", commitSha)).not.toContain("SECRET");
    execFileSync("sh", ["-n"], { input: imageBuildCommand(build, "acme/app", commitSha) });
  });
  it.each(["../../private", "/etc", "${TOKEN}", "https://host/context", "foo\\bar"])("rejects external context %s", context => {
    expect(() => repositoryPath(context)).toThrow();
  });
  it.each(["args", "secrets", "additional_contexts", "privileged", "ssh"])("fails closed on unsupported build field %s", field => {
    expect(() => plan(`services:\n  web:\n    build:\n      context: .\n      ${field}: []\n`)).toThrow(/does not yet support/);
  });
  it("does not silently downgrade an invalid provider", () => {
    expect(() => parseReleaseBuildPolicy({ provider: "typo" })).toThrow();
    expect(() => parseReleaseBuildPolicy({ provider: "daytona" })).toThrow(/GHCR/);
  });
  it("fetches the requested revision even after the branch moves", () => {
    const script = buildGithubSourceSyncCommand({ projectPath: "/opt/app", repository: "acme/app", branch: "main", commitSha });
    expect(script).toContain(`git fetch --depth 1 origin '${commitSha}'`);
    expect(script).toContain(`test "$(git rev-parse FETCH_HEAD)" = '${commitSha}'`);
    execFileSync("sh", ["-n"], { input: script });
  });
  it("redacts known credentials and limits evidence", () => {
    expect(redactBuildEvidence("Bearer abc github_pat_123 secret-value", ["secret-value"])).toBe("Bearer [REDACTED] [REDACTED] [REDACTED]");
    expect(redactBuildEvidence("x".repeat(9000))).toHaveLength(8000);
  });
});
