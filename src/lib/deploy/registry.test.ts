import { describe, it, expect } from "vitest";
import { getRegistryUri, type RegistryProvider } from "./registry";

describe("registry", () => {
  const cases: Array<{
    provider: RegistryProvider;
    projectId: string;
    region: string;
    serviceName: string;
    expected: string;
  }> = [
    {
      provider: "gcr",
      projectId: "my-project",
      region: "us",
      serviceName: "api",
      expected: "gcr.io/my-project/api",
    },
    {
      provider: "gar",
      projectId: "my-project",
      region: "us-central1",
      serviceName: "api",
      expected: "us-central1-docker.pkg.dev/my-project/api/api",
    },
    {
      provider: "ghcr",
      projectId: "groundcontrolhq",
      region: "us",
      serviceName: "api",
      expected: "ghcr.io/groundcontrolhq/api",
    },
    {
      provider: "dockerhub",
      projectId: "groundcontrol",
      region: "us",
      serviceName: "api",
      expected: "groundcontrol/api",
    },
    {
      provider: "ecr",
      projectId: "123456789012",
      region: "us-east-1",
      serviceName: "api",
      expected: "123456789012.dkr.ecr.us-east-1.amazonaws.com/api",
    },
  ];

  it.each(cases)(
    "returns the correct URI for $provider",
    ({ provider, projectId, region, serviceName, expected }) => {
      expect(getRegistryUri(provider, projectId, region, serviceName)).toBe(
        expected
      );
    }
  );

  it("throws for unknown registry providers", () => {
    expect(() =>
      getRegistryUri("unknown" as RegistryProvider, "x", "us", "api")
    ).toThrow("Unknown registry provider");
  });
});
