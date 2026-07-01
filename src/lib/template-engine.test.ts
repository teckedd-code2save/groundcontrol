import { describe, expect, it } from "vitest";
import { generatePreview, listTemplates, resolveTemplate } from "./template-engine";

function inputsFor(names: string[]): Record<string, string> {
  const values: Record<string, string> = {
    domain: "app.example.com",
    web_domain: "app.example.com",
    api_domain: "api.example.com",
    app_slug: "app",
    app_container: "app",
    app_port: "3000",
    web_port: "3000",
    api_port: "4000",
    db_user: "app",
    db_password: "secret",
    db_name: "app",
    app_secret: "secret",
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

    expect(templates.length).toBeGreaterThanOrEqual(8);
    for (const template of templates) {
      expect(template._filename).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.services.length).toBeGreaterThan(0);
      expect(template.inputs.length).toBeGreaterThan(0);
    }
  });

  it("generates compose and proxy config for every template", () => {
    for (const template of listTemplates()) {
      const resolved = resolveTemplate(template, inputsFor(template.inputs.map((input) => input.name)));
      const preview = generatePreview(resolved);

      expect(resolved.dockerCompose).toContain("services:");
      expect(resolved.dockerCompose).not.toContain("{{");
      expect(resolved.proxyConfig).not.toContain("{{");
      expect(preview).toContain("## Services");
    }
  });

  it("preserves production compose fields from templates", () => {
    const traefik = listTemplates().find((template) => template._filename === "traefik-multi-app");
    const next = listTemplates().find((template) => template._filename === "nextjs-saas-postgres-redis");
    expect(traefik).toBeTruthy();
    expect(next).toBeTruthy();

    const traefikResolved = resolveTemplate(traefik!, inputsFor(traefik!.inputs.map((input) => input.name)));
    expect(traefikResolved.dockerCompose).toContain("labels:");
    expect(traefikResolved.dockerCompose).toContain("traefik.http.routers.app.rule");

    const nextResolved = resolveTemplate(next!, inputsFor(next!.inputs.map((input) => input.name)));
    expect(nextResolved.dockerCompose).toContain("command: redis-server --appendonly yes");
    expect(nextResolved.dockerCompose).toContain('test: ["CMD-SHELL"');
  });
});
