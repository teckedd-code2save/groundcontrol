import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  buildMaterializeEnvBundleCommand,
  buildMaterializeEnvCommand,
  environmentDisplayName,
  environmentExportFilename,
  hashEnvBundle,
  hashEnv,
  maskSecret,
  normalizeProviderRuntimeEnv,
  normalizeEnvironmentSlug,
  parseDotenv,
  parseEnvSchema,
  removeEnvSchemaEntries,
  serializeDotenv,
  validateEnv,
  validateEnvBundle,
  validateEnvForComponents,
} from "./env-management";
import { buildManagedComposeInvocation } from "./vps";

describe("env management", () => {
  it("parses env schemas with optional keys by default", () => {
    const schema = parseEnvSchema(`
# comment
DATABASE_URL=<SET_ME>
REDIS_URL=redis://redis:6379
BAD LINE
DATABASE_URL=duplicate
`);

    expect(schema).toEqual([
      { key: "DATABASE_URL", required: false, defaultValue: undefined },
      { key: "REDIS_URL", required: false, defaultValue: "redis://redis:6379" },
    ]);
  });

  it("validates only explicitly required keys", () => {
    // Keys are optional by default — only keys with required:true are enforced
    const schema = [
      { key: "A", required: false },
      { key: "B", required: true },
    ];
    const values = { A: "1", B: "2" };

    expect(validateEnv(schema, values)).toEqual({
      ok: true,
      missing: [],
      hash: hashEnv(values),
    });
    expect(validateEnv(schema, { A: "1" }).missing).toEqual(["B"]);
    expect(hashEnv({ A: "1", B: "2" })).toBe(hashEnv({ B: "2", A: "1" }));
  });

  it("serializes and parses dotenv values", () => {
    const serialized = serializeDotenv({ TOKEN: "abc def", PORT: "3000" });

    expect(serialized).toContain("PORT=3000");
    expect(serialized).toContain('TOKEN="abc def"');
    expect(parseDotenv(serialized)).toEqual({ PORT: "3000", TOKEN: "abc def" });
  });

  it("masks secrets and builds atomic materialization command", () => {
    expect(maskSecret("supersecret")).toBe("•••••••cret");

    const command = buildMaterializeEnvCommand("/srv/app", "A=1\n");
    expect(command).toContain("cat > .env.new");
    expect(command).toContain("chmod 600 .env.new");
    expect(command).toContain("mv .env.new .env");
    expect(command).not.toContain("env-backups");
  });

  it("preserves Infisical sec-prefixed keys and adds runtime aliases", () => {
    expect(normalizeProviderRuntimeEnv({
      sec_DATABASE_URL: "postgres://db",
      "sec.REDIS_URL": "redis://cache",
      API_URL: "https://api.example.com",
    }, "infisical")).toEqual({
      sec_DATABASE_URL: "postgres://db",
      "sec.REDIS_URL": "redis://cache",
      DATABASE_URL: "postgres://db",
      REDIS_URL: "redis://cache",
      API_URL: "https://api.example.com",
    });
  });

  it("validates and hashes deployment and component scopes independently", () => {
    const schema = [
      { key: "PUBLIC_URL", required: true },
      { key: "DATABASE_URL", required: true, component: "api" },
      { key: "DATABASE_URL", required: true, component: "worker" },
    ];
    const components = {
      api: { DATABASE_URL: "postgres://api" },
      worker: { DATABASE_URL: "postgres://worker" },
    };

    expect(validateEnvBundle(schema, { PUBLIC_URL: "https://app.example.com" }, components)).toEqual({
      ok: true,
      missing: [],
      hash: hashEnvBundle({ PUBLIC_URL: "https://app.example.com" }, components),
    });
    expect(validateEnvBundle(schema, { PUBLIC_URL: "https://app.example.com" }, { api: components.api }).missing)
      .toEqual(["worker:DATABASE_URL"]);
  });

  it("materializes component files and a managed Compose override", () => {
    const command = buildMaterializeEnvBundleCommand(
      "/srv/app",
      { PUBLIC_URL: "https://app.example.com" },
      { api: { DATABASE_URL: "postgres://db" }, worker: { QUEUE: "critical" } }
    );

    expect(command).toContain("/api.env");
    expect(command).not.toContain(".groundcontrol/env/api.env");
    expect(command).toContain("/run/groundcontrol/environments/");
    expect(command).toContain("/worker.env");
    expect(command).toContain(".groundcontrol/compose.env.override.yml");
    expect(command).toContain(".groundcontrol/compose.env.files");
    expect(command).toContain("base64 -d");
    expect(command).not.toContain("postgres://db");
    expect(command.indexOf("rm -f '.groundcontrol/compose.env.override.yml'")).toBeLessThan(
      command.lastIndexOf("'.groundcontrol/compose.env.override.yml'.new")
    );
  });

  it("allows a component redeploy when unrelated components are incomplete", () => {
    const schema = [
      { key: "PUBLIC_URL", required: true },
      { key: "DATABASE_URL", required: true, component: "api" },
      { key: "QUEUE_URL", required: true, component: "worker" },
    ];
    const result = validateEnvForComponents(
      schema,
      { PUBLIC_URL: "https://app.example.com" },
      { api: { DATABASE_URL: "postgres://api" } },
      ["api"]
    );
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(validateEnvForComponents(schema, { PUBLIC_URL: "https://app.example.com" }, {}, ["api"]).missing)
      .toEqual(["api:DATABASE_URL"]);
  });

  it("adds managed image and environment overrides only when they exist", () => {
    const command = buildManagedComposeInvocation("docker compose", "up -d", "compose.yml");

    expect(command).toContain(".groundcontrol/compose.image.override.yml");
    expect(command).toContain(".groundcontrol/compose.env.override.yml");
    expect(command).toContain('set -- -f "$gc_compose_base"');
    expect(command).toContain('set -- "$@" -f');
    expect(command).toContain('docker compose "$@" up -d');
  });

  it("generates valid POSIX shell when Compose must discover its base file", () => {
    const command = buildManagedComposeInvocation("docker compose", "up -d --force-recreate");
    const syntax = spawnSync("/bin/sh", ["-n"], { input: command, encoding: "utf8" });

    expect(syntax.status, syntax.stderr).toBe(0);
  });

  it("removes only the requested component schema entries", () => {
    const schema = [
      { key: "TOKEN", required: true },
      { key: "TOKEN", required: true, component: "api" },
      { key: "QUEUE", required: true, component: "worker" },
    ];
    expect(removeEnvSchemaEntries(schema, ["TOKEN"], "api")).toEqual([
      { key: "TOKEN", required: true },
      { key: "QUEUE", required: true, component: "worker" },
    ]);
  });

  it("prunes only GroundControl-managed component files during deletion", () => {
    const command = buildMaterializeEnvBundleCommand("/srv/app", {}, {}, { pruneManagedFiles: true });
    expect(command).toContain("find '/run/groundcontrol/environments/");
    expect(command).toContain("rm -f '.groundcontrol/compose.env.override.yml' '.groundcontrol/compose.env.files'");
    expect(command).not.toContain("rm -f .env");
    expect(command).toContain("> '.env'.new");
  });

  it("normalizes operator environment names independently from provider slugs", () => {
    expect(normalizeEnvironmentSlug("Customer Preview")).toBe("customer-preview");
    expect(normalizeEnvironmentSlug(" ")).toBe("production");
    expect(environmentDisplayName("prod")).toBe("Production");
    expect(environmentDisplayName("customer-preview")).toBe("Customer Preview");
  });

  it("exports a visible, Mac-friendly env filename", () => {
    expect(environmentExportFilename("RentAWeekend", "Production", "api"))
      .toBe("rentaweekend.production.api.env.txt");
    expect(environmentExportFilename("RentAWeekend", "Production", ""))
      .toBe("rentaweekend.production.shared.env.txt");
  });
});
