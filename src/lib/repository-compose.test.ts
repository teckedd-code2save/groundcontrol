import { describe, expect, it } from "vitest";
import {
  inspectRepositoryCompose,
  normalizeRepositoryComposePath,
  repositoryComposeEnvSchema,
} from "./repository-compose";

const scenegraphCompose = `
services:
  gateway:
    image: caddy:2.10-alpine
    ports:
      - "\${SCENEGRAPH_PORT:-8080}:8080"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/healthz"]
  studio:
    build:
      context: .
      dockerfile: apps/studio/Dockerfile
  director:
    build:
      context: .
      dockerfile: services/director/Dockerfile
    environment:
      SCENEGRAPH_PUBLIC_URL: \${SCENEGRAPH_PUBLIC_URL:?Set the public HTTPS URL}
      SCENEGRAPH_ACCESS_TOKEN: \${SCENEGRAPH_ACCESS_TOKEN:?Set a strong access token}
  render-worker:
    build:
      context: .
      dockerfile: services/render-worker/Dockerfile
  redis:
    image: redis:7.4-alpine
`;

describe("repository Compose inspection", () => {
  it.each(["${APP_PORT}", "${APP_PORT:?Choose a port}", "${APP_PORT?Choose a port}", "${APP_PORT:-3000}", "${APP_PORT-3000}", "$APP_PORT"])("resolves the supplied host port in %s", (expression) => {
    const content = `services:\n  app:\n    ports: ["127.0.0.1:${expression}:3000"]\n`;
    const result = inspectRepositoryCompose(content, { APP_PORT: "13030" });
    expect(result.publishedPorts).toEqual([{ service: "app", hostIp: "127.0.0.1", hostPort: "13030", containerPort: "3000" }]);
  });

  it("resolves long syntax with the same environment and never returns an unresolved port", () => {
    const content = `services:\n  app:\n    ports:\n      - host_ip: 127.0.0.1\n        published: \${APP_PORT:?required}\n        target: \${CONTAINER_PORT:-3000}\n`;
    expect(inspectRepositoryCompose(content).publishedPorts).toEqual([]);
    expect(inspectRepositoryCompose(content, { APP_PORT: "13030" }).publishedPorts).toEqual([
      { service: "app", hostIp: "127.0.0.1", hostPort: "13030", containerPort: "3000" },
    ]);
  });

  it("honors unset versus empty defaults and does not read the control-plane environment", () => {
    const content = (value: string) => `services:\n  app:\n    ports: ["127.0.0.1:${value}:3000"]\n`;
    expect(inspectRepositoryCompose(content("${PORT:-13030}"), { PORT: "" }).suggestedPublicPort).toBe("13030");
    expect(inspectRepositoryCompose(content("${PORT-13030}"), { PORT: "" }).publishedPorts).toEqual([]);
    expect(inspectRepositoryCompose(content("$${PORT:-13030}")).publishedPorts).toEqual([]);
    expect(inspectRepositoryCompose(content("${PORT:?required}"), { PORT: "not-a-port" }).publishedPorts).toEqual([]);
  });

  it("discovers a Scenegraph-style stack without requiring a root Dockerfile", () => {
    const inspected = inspectRepositoryCompose(scenegraphCompose);

    expect(inspected.services).toEqual(["gateway", "studio", "director", "render-worker", "redis"]);
    expect(inspected.suggestedPublicService).toBe("gateway");
    expect(inspected.suggestedPublicPort).toBe("8080");
    expect(inspected.suggestedHealthPath).toBe("/healthz");
    expect(inspected.publishedPorts).toContainEqual({
      service: "gateway",
      hostPort: "8080",
      containerPort: "8080",
      hostIp: undefined,
    });
    expect(inspected.environment).toEqual([
      { key: "SCENEGRAPH_ACCESS_TOKEN", required: true, defaultValue: undefined, message: "Set a strong access token" },
      { key: "SCENEGRAPH_PORT", required: false, defaultValue: "8080", message: undefined },
      { key: "SCENEGRAPH_PUBLIC_URL", required: true, defaultValue: undefined, message: "Set the public HTTPS URL" },
    ]);
    expect(repositoryComposeEnvSchema(inspected.environment)).toContain("SCENEGRAPH_ACCESS_TOKEN=<SET_ME>");
  });

  it("rejects absolute and escaping Compose paths", () => {
    expect(() => normalizeRepositoryComposePath("/tmp/compose.yml")).toThrow(/repository-relative/i);
    expect(() => normalizeRepositoryComposePath("../compose.yml")).toThrow(/repository-relative/i);
    expect(normalizeRepositoryComposePath("deploy/compose.yaml")).toBe("deploy/compose.yaml");
  });
});
