import { describe, expect, it } from "vitest";
import { parseComposeServices } from "./project-scan";

describe("project scan compose parser", () => {
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
