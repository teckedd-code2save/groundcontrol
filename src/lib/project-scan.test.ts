import { describe, expect, it } from "vitest";
import { parseComposeServices } from "./project-scan";

describe("project scan compose parser", () => {
  it("flags glued multi-file content as invalid (missing newline regression)", () => {
    // What the old batch-cat produced when optimi.yml had no trailing newline:
    // last line of optimi + delimiter + bootstrap compose → duplicate "services:" keys.
    const glued =
      `services:\n  backend:\n    image: x\n    restart: unless-stopped` +
      `===PROJECT:/opt/groundcontrol-bootstrap===\n` +
      `services:\n  app:\n    image: y\n`;
    const parsed = parseComposeServices(glued);
    expect(parsed.valid).toBe(false);
    expect(parsed.error || "").toMatch(/unique|mapping|parse/i);
  });

  it("parses optimi-shaped compose (build-only service, no trailing newline)", () => {
    const content = `services:
  backend:
    build:
      context: ./scraper
      dockerfile: Dockerfile
    container_name: optimi-backend
    ports:
      - "127.0.0.1:8000:8000"
    env_file:
      - ./scraper/.env
    restart: unless-stopped`;
    const parsed = parseComposeServices(content);
    expect(parsed.valid).toBe(true);
    expect(parsed.services).toHaveLength(1);
    expect(parsed.services[0].name).toBe("backend");
    expect(parsed.services[0].build).toBe(true);
  });

  it("extracts component metadata from compose services", () => {
    const parsed = parseComposeServices(`
services:
  web:
    image: ghcr.io/acme/web:latest
    env_file:
      - .env
      - ./web.env
    environment:
      NEXT_PUBLIC_API_URL: https://api.example.com
      FEATURE_FLAG: "true"
    ports:
      - "127.0.0.1:13000:3000"
    labels:
      caddy: web.example.com
      traefik.http.routers.web.rule: Host(\`web.example.com\`)
    volumes:
      - uploads:/app/uploads
    networks:
      - app
    depends_on:
      - api
  api:
    build: .
    environment:
      - DATABASE_URL=postgres://postgres/app
`);

    expect(parsed.valid).toBe(true);
    expect(parsed.domain).toBe("web.example.com");
    expect(parsed.services).toMatchObject([
      {
        name: "web",
        image: "ghcr.io/acme/web:latest",
        envFiles: [".env", "./web.env"],
        environment: ["NEXT_PUBLIC_API_URL", "FEATURE_FLAG"],
        ports: ["127.0.0.1:13000:3000"],
        labels: ["caddy=web.example.com", "traefik.http.routers.web.rule=Host(`web.example.com`)"],
        volumes: ["uploads:/app/uploads"],
        networks: ["app"],
        dependsOn: ["api"],
      },
      {
        name: "api",
        build: true,
        environment: ["DATABASE_URL"],
      },
    ]);
  });
});
