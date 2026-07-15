import { describe, expect, it } from "vitest";
import { inferDeploymentName, slugifyDeploymentName } from "./deployment-identity";

describe("deployment identity", () => {
  it("uses an explicit name before source metadata", () => {
    expect(inferDeploymentName({ explicitName: "Customer Web", repoUrl: "https://github.com/acme/site" }))
      .toBe("Customer Web");
  });

  it("derives the name from a repository when no explicit name exists", () => {
    expect(inferDeploymentName({ repoUrl: "https://github.com/teckedd-code2save/pocket-models.git" }))
      .toBe("pocket-models");
  });

  it("falls back through local paths, images, domains, and template names", () => {
    expect(inferDeploymentName({ localPath: "/opt/payments-api/" })).toBe("payments-api");
    expect(inferDeploymentName({ image: "ghcr.io/acme/worker:latest" })).toBe("worker");
    expect(inferDeploymentName({ domain: "https://docs.example.com/path" })).toBe("docs");
    expect(inferDeploymentName({ templateName: "source-build" })).toBe("source-build");
  });

  it("creates a stable deployment slug", () => {
    expect(slugifyDeploymentName("Customer Web / Production")).toBe("customer-web-production");
  });
});
