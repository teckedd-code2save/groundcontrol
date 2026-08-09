import { describe, expect, it } from "vitest";
import { deploymentTargetDisplayName, isTemplateManagedTarget } from "./deployment-target-label";

describe("deployment target labels", () => {
  it("hides template-specific target names for generic compose release history", () => {
    const target = {
      name: "Template: gc-company-site",
      type: "compose",
      configJson: JSON.stringify({ managedBy: "template-deploy" }),
    };

    expect(isTemplateManagedTarget(target)).toBe(true);
    expect(deploymentTargetDisplayName(target)).toBe("Docker Compose");
  });

  it("keeps normal operator target names", () => {
    expect(deploymentTargetDisplayName({
      name: "Production VPS",
      type: "compose",
      configJson: JSON.stringify({ managedBy: "groundcontrol" }),
    })).toBe("Production VPS");
  });
});
