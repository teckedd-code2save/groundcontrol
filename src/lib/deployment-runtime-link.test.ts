import { describe, expect, it } from "vitest";
import { linkDeploymentRuntime } from "./deployment-runtime-link";

describe("deployment runtime reconciliation", () => {
  it("links every Compose service using the project working directory", () => {
    const containers = [
      { name: "shop-api-1", image: "shop-api", status: "Up", ports: "3000/tcp", state: "running" },
      { name: "shop-db-1", image: "postgres", status: "Up", ports: "5432/tcp", state: "running" },
    ];
    const labels = containers.map((container, index) => ({
      name: container.name,
      project: "shop",
      service: index === 0 ? "api" : "db",
      workingDir: "/opt/shop",
      configFiles: "/opt/shop/docker-compose.yml",
      projectSlug: "shop",
    }));
    const result = linkDeploymentRuntime({ sourcePath: "/opt/shop" }, containers, labels);
    expect(result.status).toBe("present");
    expect(result.composeProject).toBe("shop");
    expect(result.containers.map((item) => item.service)).toEqual(["api", "db"]);
  });
});
