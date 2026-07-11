import { describe, expect, it } from "vitest";
import {
  evaluateSourceRequirements,
  getTemplateSourcePlan,
  probeFromGithubRootListing,
} from "./template-source-requirements";

const sourceBuild = {
  category: "source",
  deploy_mode: "compose",
  services: [{ name: "app", build: true }],
  inputs: [{ name: "domain" }, { name: "app_slug" }],
};

const staticSite = {
  category: "static",
  deploy_mode: "static",
  services: [] as { build?: boolean; name?: string }[],
  inputs: [{ name: "domain" }, { name: "output_dir" }],
};

describe("template source requirements", () => {
  it("requires Dockerfile for source-build", () => {
    const plan = getTemplateSourcePlan(sourceBuild);
    expect(plan.requiresDockerfile).toBe(true);
    expect(plan.allowedSources).toEqual(["github", "local"]);

    const missing = evaluateSourceRequirements(
      sourceBuild,
      probeFromGithubRootListing([
        { name: "index.html", path: "index.html", type: "file" },
        { name: "app.js", path: "app.js", type: "file" },
      ]),
      { sourceMode: "github" }
    );
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]).toMatch(/Dockerfile/i);
    expect(missing.errors[0]).toMatch(/Static Site/i);
  });

  it("accepts Dockerfile for source-build", () => {
    const ok = evaluateSourceRequirements(
      sourceBuild,
      probeFromGithubRootListing([
        { name: "Dockerfile", path: "Dockerfile", type: "file" },
        { name: "package.json", path: "package.json", type: "file" },
      ]),
      { sourceMode: "github" }
    );
    expect(ok.ok).toBe(true);
  });

  it("accepts plain HTML for static site (pocket-models shape)", () => {
    const plan = getTemplateSourcePlan(staticSite);
    expect(plan.deployMode).toBe("static");
    expect(plan.requiresDockerfile).toBe(false);

    const ok = evaluateSourceRequirements(
      staticSite,
      probeFromGithubRootListing([
        { name: "index.html", path: "index.html", type: "file" },
        { name: "app.js", path: "app.js", type: "file" },
        { name: "styles.css", path: "styles.css", type: "file" },
      ]),
      { sourceMode: "github" }
    );
    expect(ok.ok).toBe(true);
  });

  it("rejects empty tree for static site", () => {
    const bad = evaluateSourceRequirements(
      staticSite,
      probeFromGithubRootListing([
        { name: "README.md", path: "README.md", type: "file" },
      ]),
      { sourceMode: "github" }
    );
    expect(bad.ok).toBe(false);
  });
});
