import { describe, expect, it } from "vitest";
import { branchFromPushRef, githubAutoDeployIdempotencyKey, grantCanDeploy, readGithubAutoDeployPolicy } from "./github-auto-deploy";

describe("GitHub auto deploy policy", () => {
  it("accepts branch pushes and ignores tag pushes", () => {
    expect(branchFromPushRef("refs/heads/main")).toBe("main");
    expect(branchFromPushRef("refs/heads/release/next")).toBe("release/next");
    expect(branchFromPushRef("refs/tags/v1.0.0")).toBeNull();
  });

  it("defaults to disabled and reads an explicit allowlisted branch", () => {
    expect(readGithubAutoDeployPolicy("{}")).toEqual({ enabled: false, branch: "main" });
    expect(readGithubAutoDeployPolicy(JSON.stringify({ sourceRepair: { defaultBranch: "production", autoDeployEnabled: true } })))
      .toEqual({ enabled: true, branch: "production" });
  });

  it("requires both redeploy scope and the deployment resource", () => {
    expect(grantCanDeploy("deployment:read deployment:redeploy", "[3,19]", 3)).toBe(true);
    expect(grantCanDeploy("deployment:read", "[3]", 3)).toBe(false);
    expect(grantCanDeploy("deployment:redeploy", "[19]", 3)).toBe(false);
  });

  it("makes webhook retries idempotent per deployment", () => {
    expect(githubAutoDeployIdempotencyKey("delivery-1", 3)).toBe("github-push:delivery-1:3");
  });
});
