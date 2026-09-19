// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const path = join(process.cwd(), ".github", "workflows", "distribution-acceptance.yml");
const source = readFileSync(path, "utf8");
const workflow = parse(source) as {
  name?: string;
  on?: Record<string, unknown>;
  jobs?: Record<string, {
    steps?: Array<{ name?: string; run?: string; uses?: string }>;
  }>;
};

describe("distribution acceptance workflow", () => {
  it("is valid YAML with manual and post-deploy triggers", () => {
    expect(workflow.name).toBe("Distribution Acceptance");
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on).toHaveProperty("workflow_run");
    expect(workflow.jobs).toHaveProperty("clean-host");
  });

  it("exercises the canonical install, human claim, verification, upgrade and uninstall path", () => {
    const steps = workflow.jobs?.["clean-host"]?.steps || [];
    const script = steps.map((step) => step.run || "").join("\n");

    expect(script).toContain("scripts/install --version");
    expect(script).toContain("/api/auth/claim");
    expect(script).toContain('/api/instance/publish');
    expect(script).toContain('"action":"private"');
    expect(script).toContain("scripts/install --preview");
    expect(script).toContain("scripts/install --upgrade");
    expect(script).toContain("scripts/install --uninstall");
  });

  it("proves the private control plane remains loopback-only and preserves data on uninstall", () => {
    const steps = workflow.jobs?.["clean-host"]?.steps || [];
    const script = steps.map((step) => step.run || "").join("\n");

    expect(script).toContain("127\\.0\\.0\\.1");
    expect(script).toContain("/root/.ssh");
    expect(script).toContain(".dataPreserved == true");
    expect(script).toContain("docker volume inspect");
  });

  it("redacts the one-time claim material before uploading evidence", () => {
    const steps = workflow.jobs?.["clean-host"]?.steps || [];
    const script = steps.map((step) => step.run || "").join("\n");

    expect(script).toContain("del(.claimToken,.claimUrl,.claimPath)");
    expect(source).toContain("actions/upload-artifact@v4");
  });
});
