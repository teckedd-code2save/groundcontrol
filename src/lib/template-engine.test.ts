import { describe, expect, it } from "vitest";
import { generatePreview, listTemplates, resolveTemplate, validateComposeDocument } from "./template-engine";

function inputsFor(names: string[]): Record<string, string> {
  const values: Record<string, string> = {
    domain: "app.example.com",
    web_domain: "app.example.com",
    api_domain: "api.example.com",
    dashboard_domain: "dash.example.com",
    admin_domain: "admin.example.com",
    app_slug: "app",
    app_container: "app",
    app_port: "3000",
    app_host_port: "13000",
    frontend_host_port: "13001",
    backend_host_port: "13002",
    web_host_port: "13003",
    api_host_port: "13004",
    minio_host_port: "19000",
    node_port: "30080",
    web_port: "3000",
    api_port: "4000",
    web_image: "nginxdemos/hello:latest",
    api_image: "nginxdemos/hello:latest",
    worker_image: "alpine:3.20",
    frontend_image: "nginxdemos/hello:latest",
    backend_image: "nginxdemos/hello:latest",
    app_image: "nginxdemos/hello:latest",
    postgres_image: "postgres:16-alpine",
    mysql_image: "mysql:8.4",
    redis_image: "redis:7-alpine",
    minio_image: "minio/minio:latest",
    cloudflared_image: "cloudflare/cloudflared:latest",
    caddy_image: "caddy:2-alpine",
    traefik_image: "traefik:v3.3",
    db_user: "app",
    db_password: "secret",
    db_name: "app",
    minio_root_user: "minio",
    minio_root_password: "minio-secret",
    app_secret: "secret",
    tunnel_token: "token",
    namespace: "app",
    replicas: "2",
    rails_master_key: "secret",
    django_project: "config",
    web_workers: "3",
    asgi_app: "app.main:app",
    api_workers: "2",
    worker_command: "npm run worker",
    web_command: "npm run web",
    api_command: "npm run api",
    acme_email: "admin@example.com",
    repo_dir: ".",
  };

  return Object.fromEntries(names.map((name) => [name, values[name] ?? `${name}-value`]));
}

describe("template engine", () => {
  it("loads every template with services and inputs", () => {
    const templates = listTemplates();

    expect(templates.map((template) => template._filename).sort()).toEqual([
      "cloudflare-tunnel-private-apps",
      "k3s-caddy-nodeport-platform",
      "vps-caddy-commerce-secure",
      "vps-nginx-polyglot-secure",
      "vps-traefik-scaled-services",
    ]);
    for (const template of templates) {
      expect(template._filename).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.services.length).toBeGreaterThan(0);
      expect(template.inputs.length).toBeGreaterThan(0);
      expect(template.components?.length).toBeGreaterThan(0);
      expect(template.components?.every((component) => component.layer && component.kind)).toBe(true);
    }
  });

  it("generates compose and proxy config for every template", () => {
    for (const template of listTemplates()) {
      const resolved = resolveTemplate(template, inputsFor(template.inputs.map((input) => input.name)));
      const preview = generatePreview(resolved);

      expect(resolved.dockerCompose).toContain("services:");
      expect(resolved.dockerCompose).not.toContain("{{");
      expect(resolved.proxyConfig).not.toContain("{{");
      expect(resolved.manifest).toContain('"managedBy": "groundcontrol"');
      expect(preview).toContain("## Services");
      expect(preview).toContain("## Layers");
      expect(validateComposeDocument(resolved.dockerCompose).ok).toBe(true);
    }
  });

  it("preserves production compose fields from templates", () => {
    const traefik = listTemplates().find((template) => template._filename === "vps-traefik-scaled-services");
    const caddy = listTemplates().find((template) => template._filename === "vps-caddy-commerce-secure");
    expect(traefik).toBeTruthy();
    expect(caddy).toBeTruthy();

    const traefikResolved = resolveTemplate(traefik!, inputsFor(traefik!.inputs.map((input) => input.name)));
    expect(traefikResolved.dockerCompose).toContain("labels:");
    expect(traefikResolved.dockerCompose).toContain("traefik.http.routers.web.rule");

    const caddyResolved = resolveTemplate(caddy!, inputsFor(caddy!.inputs.map((input) => input.name)));
    expect(caddyResolved.dockerCompose).toContain("redis-server --appendonly yes");
    expect(caddyResolved.dockerCompose).toContain('test: ["CMD-SHELL"');
  });

  it("rejects invalid compose service shapes", () => {
    expect(validateComposeDocument("name: bad\nservices: []").ok).toBe(false);
    expect(validateComposeDocument("name: bad\nservices:\n").ok).toBe(false);
    expect(validateComposeDocument("services:\n  app:\n    image: nginx").ok).toBe(true);
  });
});
