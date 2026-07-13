import { describe, it, expect } from "vitest";
import { deployTargets, normalizeTargetType, createAdapter } from "./index";
import type { Project, DeploymentTarget } from "@prisma/client";

const mockProject = {
  id: 1,
  slug: "test-project",
  name: "Test Project",
  repoUrl: null,
  path: "/opt/test-project",
  dockerfile: null,
  buildCommand: null,
  outputDir: null,
  domain: null,
  envVars: null,
  caddyFile: null,
  dockerCompose: null,
  category: "static",
  status: "unknown",
  lastDeploy: null,
  projectGroupId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Project;

const mockTarget = (type: string): DeploymentTarget => ({
  id: 1,
  name: "test-target",
  type,
  vpsConfigId: null,
  cloudProviderAccountId: null,
  configJson: JSON.stringify({}),
  isActive: false,
  dnsRecordId: null,
  dnsRecordName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("deploy targets index", () => {
  it("exports the expected target factories", () => {
    expect(Object.keys(deployTargets).sort()).toEqual([
      "cloudrun",
      "compose",
      "k3s",
      "static",
    ]);
  });

  it("normalises docker-compose to compose", () => {
    expect(normalizeTargetType("docker-compose")).toBe("compose");
    expect(normalizeTargetType("compose")).toBe("compose");
    expect(normalizeTargetType("k3s")).toBe("k3s");
  });

  describe.each([
    ["compose"],
    ["static"],
    ["k3s"],
    ["cloudrun"],
  ])("%s adapter", (type) => {
    it("has required DeployTarget methods", () => {
      const adapter = createAdapter(mockProject, mockTarget(type));

      expect(adapter.type).toBe(type === "docker-compose" ? "compose" : type);
      expect(typeof adapter.prepare).toBe("function");
      expect(typeof adapter.build).toBe("function");
      expect(typeof adapter.deploy).toBe("function");
      expect(typeof adapter.rollback).toBe("function");
      expect(typeof adapter.destroy).toBe("function");
    });
  });

  it("throws for an unknown target type", () => {
    expect(() =>
      createAdapter(mockProject, mockTarget("unknown"))
    ).toThrow("Unknown deployment target type");
  });
});
