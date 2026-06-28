// src/lib/template-engine.ts
//
// Loads deployment templates from YAML files, resolves user inputs,
// and generates docker-compose.yml + reverse proxy configuration.

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

// ── Types ──────────────────────────────────────────────

export interface TemplateInput {
  name: string;
  prompt?: string;
  example?: string;
  default?: string;
  generate?: boolean;  // Auto-generate a secure value
}

export interface TemplateService {
  name: string;
  image?: string;
  build?: boolean;
  ports?: string[];
  env?: string[];
  volumes?: string[];
  depends_on?: string[];
  restart?: string;
  healthcheck?: {
    test: string;
    interval: string;
    timeout: string;
    retries: number;
  };
}

export interface ProxySite {
  domain: string;
  proxy_to: string;
  root?: string;
}

export interface TemplateDefinition {
  name: string;
  description: string;
  category: string;
  version: string;
  requires: {
    docker?: boolean;
    caddy?: boolean;
    traefik?: boolean;
    nginx?: boolean;
    k3s?: boolean;
  };
  reverse_proxy: {
    type: "caddy" | "traefik" | "nginx";
    sites?: ProxySite[];
    global_config?: string;
  };
  services: TemplateService[];
  volumes?: string[];
  networks?: string[];
  inputs: TemplateInput[];
}

export interface ResolvedTemplate {
  definition: TemplateDefinition;
  inputs: Record<string, string>;
  dockerCompose: string;
  proxyConfig: string;
  proxyConfigPath: string;
  envSchema: string;
}

// ── Template loading ──────────────────────────────────

const TEMPLATES_DIR = join(process.cwd(), "templates");

export function listTemplates(): TemplateDefinition[] {
  try {
    const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
    return files.map(f => loadTemplate(f)).filter(Boolean) as TemplateDefinition[];
  } catch {
    return [];
  }
}

export function loadTemplate(filename: string): TemplateDefinition | null {
  try {
    const path = join(TEMPLATES_DIR, filename);
    const content = readFileSync(path, "utf-8");
    return parseTemplateYaml(content);
  } catch {
    return null;
  }
}

// Simple YAML parser for our template format (no external deps)
function parseTemplateYaml(content: string): TemplateDefinition {
  const lines = content.split("\n");
  const root: Record<string, unknown> = {};
  let currentSection: string | null = null;
  let currentArray: unknown[] = [];
  let currentArrayKey = "";
  let currentService: Record<string, unknown> | null = null;
  let currentInput: Record<string, unknown> | null = null;
  let currentSite: Record<string, unknown> | null = null;
  let services: Record<string, unknown>[] = [];
  let inputs: Record<string, unknown>[] = [];
  let sites: Record<string, unknown>[] = [];
  let requires: Record<string, unknown> = {};
  let envVars: string[] = [];
  let volumes: string[] = [];
  let networks: string[] = [];
  let dependsOn: string[] = [];
  let proxyType = "caddy";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Top-level scalar: key: "value" (name, description, category, version)
    const topScalar = trimmed.match(/^(\w[\w_]*):\s*"?(.+?)"?\s*$/);
    if (topScalar && !line.startsWith(" ")) {
      const key = topScalar[1];
      const val = topScalar[2];
      if (["name", "description", "category", "version"].includes(key)) {
        root[key] = val;
      }
      continue;
    }

    // Top-level key that opens a section (no value on same line)
    const topMatch = trimmed.match(/^(\w[\w_]*):\s*$/);
    if (topMatch && !line.startsWith(" ")) {
      currentSection = topMatch[1];
      currentService = null;
      continue;
    }

    // Indented scalar
    const indentedScalar = trimmed.match(/^  (\w[\w_]*):\s*"?(.+)"?\s*$/);
    if (indentedScalar && currentSection === "reverse_proxy") {
      const key = indentedScalar[1];
      const val = indentedScalar[2];
      if (key === "type") proxyType = val;
      continue;
    }
    if (indentedScalar && currentSection === "requires") {
      requires[indentedScalar[1]] = indentedScalar[2] === "true";
      continue;
    }

    // Array item
    const arrayItem = trimmed.match(/^  -\s*"?(.+)"?$/);
    if (arrayItem && currentSection === "services" && currentService) {
      const val = arrayItem[1];
      if (trimmed.includes("depends_on") || currentArrayKey === "depends_on") {
        dependsOn.push(val);
        currentArrayKey = "depends_on";
      } else if (currentArrayKey === "env" || trimmed.includes("env:")) {
        if (trimmed.startsWith("  - ")) envVars.push(val);
        currentArrayKey = "env";
      } else if (currentArrayKey === "volumes" || trimmed.includes("volumes:")) {
        if (trimmed.startsWith("  - ")) volumes.push(val);
        currentArrayKey = "volumes";
      } else if (currentArrayKey === "ports" || trimmed.includes("ports:")) {
        currentArray.push(val);
      }
      continue;
    }
    if (arrayItem && currentSection === "volumes") {
      volumes.push(arrayItem[1]);
      continue;
    }
    if (arrayItem && currentSection === "networks") {
      networks.push(arrayItem[1]);
      continue;
    }

    // Service name
    if (currentSection === "services" && trimmed.match(/^  (\w[\w-]*):\s*$/)) {
      if (currentService) {
        if (envVars.length) currentService["env"] = envVars;
        if (volumes.length) currentService["volumes"] = volumes;
        if (dependsOn.length) currentService["depends_on"] = dependsOn;
        services.push(currentService);
      }
      currentService = { name: trimmed.replace(/:$/, "").trim() };
      envVars = [];
      volumes = [];
      dependsOn = [];
      currentArrayKey = "";
      continue;
    }

    // Input name
    if (currentSection === "inputs" && trimmed.match(/^  (\w[\w-]*):\s*$/)) {
      if (currentInput) inputs.push(currentInput);
      currentInput = { name: trimmed.replace(/:$/, "").trim() };
      continue;
    }

    // Site entry
    if (currentSection === "reverse_proxy" && trimmed.match(/^    -\s*$/)) {
      currentSite = {};
      continue;
    }

    // Input property
    if (currentInput) {
      const propMatch = trimmed.match(/^    (\w+):\s*"?(.+)"?\s*$/);
      if (propMatch) currentInput[propMatch[1]] = propMatch[2];
      continue;
    }

    // Service property
    if (currentService) {
      const sProp = trimmed.match(/^    (\w[\w_]*):\s*"?(.+)"?\s*$/);
      if (sProp) {
        const key = sProp[1];
        const val = sProp[2];
        if (key === "build") currentService[key] = val === "true";
        else if (key === "restart" || key === "image") currentService[key] = val;
        continue;
      }
      // Array key
      const arrKey = trimmed.match(/^    (\w+):\s*$/);
      if (arrKey) { currentArrayKey = arrKey[1]; currentArray = []; continue; }
      // Ports array item
      if (currentArrayKey === "ports" && arrayItem) {
        currentArray.push(arrayItem[1]);
        continue;
      }
      continue;
    }

    // Site properties
    if (currentSite) {
      const siteProp = trimmed.match(/^      (\w+):\s*"?(.+)"?\s*$/);
      if (siteProp) currentSite[siteProp[1]] = siteProp[2];
      continue;
    }
  }

  // Finalize
  if (currentService) {
    if (envVars.length) currentService["env"] = envVars;
    if (volumes.length) currentService["volumes"] = volumes;
    if (dependsOn.length) currentService["depends_on"] = dependsOn;
    if (currentArray.length) (currentService as any)[currentArrayKey || "ports"] = currentArray;
    services.push(currentService);
  }
  if (currentInput) inputs.push(currentInput);

  const svcs = services.map(s => ({ name: (s.name || "") as string, ...s } as TemplateService));
  const inps = inputs.map(i => ({ name: (i.name || "") as string, ...i } as TemplateInput));

  return {
    name: (root.name as string) || "Unnamed",
    description: (root.description as string) || "",
    category: (root.category as string) || "general",
    version: (root.version as string) || "1.0",
    requires: {
      docker: requires.docker !== false,
      caddy: proxyType === "caddy",
      traefik: proxyType === "traefik",
      nginx: proxyType === "nginx",
      k3s: requires.k3s === true,
    },
    reverse_proxy: { type: proxyType as "caddy" | "traefik" | "nginx", sites: sites as any, global_config: requires.global_config as string },
    services: svcs,
    volumes,
    networks,
    inputs: inps,
  };
}

// ── Resolution ─────────────────────────────────────────

export function resolveTemplate(
  template: TemplateDefinition,
  userInputs: Record<string, string>
): ResolvedTemplate {
  const resolvedInputs = resolveInputs(template.inputs, userInputs);
  const dockerCompose = generateDockerCompose(template, resolvedInputs, userInputs);
  const proxyConfig = generateProxyConfig(template, resolvedInputs);
  const envSchema = generateEnvSchema(template, resolvedInputs);

  return {
    definition: template,
    inputs: resolvedInputs,
    dockerCompose,
    proxyConfig,
    proxyConfigPath: template.reverse_proxy.type === "caddy"
      ? `/etc/caddy/sites/${resolvedInputs.domain || "app"}.conf`
      : template.reverse_proxy.type === "traefik"
      ? `/etc/traefik/dynamic/${resolvedInputs.domain || "app"}.yml`
      : `/etc/nginx/sites-available/${resolvedInputs.domain || "app"}`,
    envSchema,
  };
}

function resolveInputs(templateInputs: TemplateInput[], userInputs: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const input of templateInputs) {
    if (userInputs[input.name]) {
      resolved[input.name] = userInputs[input.name];
    } else if (input.generate) {
      resolved[input.name] = generateSecureValue();
    } else if (input.default) {
      resolved[input.name] = input.default;
    }
  }
  return resolved;
}

function generateSecureValue(): string {
  return randomBytes(24).toString("base64url");
}

// ── Docker Compose generation ──────────────────────────

function generateDockerCompose(
  template: TemplateDefinition,
  resolved: Record<string, string>,
  userInputs: Record<string, string>
): string {
  const lines = [`# Generated by GroundControl — ${template.name} v${template.version}`, `# ${new Date().toISOString()}`, "", `services:`];

  for (const svc of template.services) {
    const svcName = resolveTemplateString(svc.name, resolved);
    lines.push(`  ${svcName}:`);

    if (svc.image) {
      lines.push(`    image: ${resolveTemplateString(svc.image, resolved)}`);
    }
    if (svc.build) {
      const context = userInputs["repo_dir"] || ".";
      lines.push(`    build:`);
      lines.push(`      context: ${context}`);
    }
    if (svc.restart) {
      lines.push(`    restart: ${svc.restart}`);
    } else {
      lines.push(`    restart: unless-stopped`);
    }
    if (svc.ports && svc.ports.length > 0) {
      lines.push(`    ports:`);
      for (const p of svc.ports) lines.push(`      - "${resolveTemplateString(p, resolved)}"`);
    }
    if (svc.env && svc.env.length > 0) {
      lines.push(`    environment:`);
      for (const e of svc.env) lines.push(`      - ${resolveTemplateString(e, resolved)}`);
    }
    if (svc.volumes && svc.volumes.length > 0) {
      lines.push(`    volumes:`);
      for (const v of svc.volumes) lines.push(`      - ${resolveTemplateString(v, resolved)}`);
    }
    if (svc.depends_on && svc.depends_on.length > 0) {
      lines.push(`    depends_on:`);
      for (const d of svc.depends_on) lines.push(`      ${resolveTemplateString(d, resolved)}:`);
      lines.push(`        condition: service_started`);
    }
    if (svc.healthcheck) {
      lines.push(`    healthcheck:`);
      lines.push(`      test: ${JSON.stringify(svc.healthcheck.test.split(" "))}`);
      lines.push(`      interval: ${svc.healthcheck.interval}`);
      lines.push(`      timeout: ${svc.healthcheck.timeout}`);
      lines.push(`      retries: ${svc.healthcheck.retries}`);
    }
    lines.push("");
  }

  if (template.volumes && template.volumes.length > 0) {
    lines.push("volumes:");
    for (const v of template.volumes) lines.push(`  ${resolveTemplateString(v, resolved)}:`);
    lines.push("");
  }
  if (template.networks && template.networks.length > 0) {
    lines.push("networks:");
    for (const n of template.networks) lines.push(`  ${resolveTemplateString(n, resolved)}:`);
    lines.push("  driver: bridge");
    lines.push("");
  }

  return lines.join("\n");
}

// ── Proxy config generation ────────────────────────────

function generateProxyConfig(
  template: TemplateDefinition,
  resolved: Record<string, string>
): string {
  const domain = resolved.domain || "example.com";
  const type = template.reverse_proxy.type;

  if (type === "caddy") {
    const lines = [`# Generated by GroundControl — ${template.name}`, ""];
    if (template.reverse_proxy.sites && template.reverse_proxy.sites.length > 0) {
      for (const site of template.reverse_proxy.sites) {
        const d = resolveTemplateString(site.domain, resolved);
        const proxy = resolveTemplateString(site.proxy_to, resolved);
        lines.push(`${d} {`);
        if (site.root) {
          lines.push(`  root * ${resolveTemplateString(site.root, resolved)}`);
          lines.push(`  file_server`);
        } else {
          lines.push(`  reverse_proxy ${proxy}`);
        }
        lines.push(`  encode gzip`);
        lines.push(`  header / {`);
        lines.push(`    X-Frame-Options "DENY"`);
        lines.push(`    X-Content-Type-Options "nosniff"`);
        lines.push(`    Referrer-Policy "strict-origin-when-cross-origin"`);
        lines.push(`  }`);
        lines.push(`}`);
      }
    } else {
      lines.push(`${domain} {`);
      lines.push(`  reverse_proxy localhost:${resolved.app_port || "3000"}`);
      lines.push(`  encode gzip`);
      lines.push(`}`);
    }
    return lines.join("\n");
  }

  if (type === "traefik") {
    return `# Traefik dynamic config for ${domain}
http:
  routers:
    ${resolved.app_container || "app"}-router:
      rule: "Host(\`${domain}\`)"
      service: ${resolved.app_container || "app"}-service
      tls:
        certResolver: letsencrypt
  services:
    ${resolved.app_container || "app"}-service:
      loadBalancer:
        servers:
          - url: "http://${resolved.app_container || "app"}:${resolved.app_port || "3000"}"`;
  }

  // nginx
  const lines = [`# Nginx config for ${domain}`, `server {`, `  listen 80;`, `  server_name ${domain};`, ``,
    `  location / {`, `    proxy_pass http://localhost:${resolved.app_port || "3000"};`,
    `    proxy_set_header Host $host;`, `    proxy_set_header X-Real-IP $remote_addr;`, `  }`, `}`];
  return lines.join("\n");
}

// ── Env schema generation ──────────────────────────────

function generateEnvSchema(
  template: TemplateDefinition,
  resolved: Record<string, string>
): string {
  const lines = ["# Environment variables required by this deployment"];
  for (const svc of template.services) {
    if (!svc.env) continue;
    for (const e of svc.env) {
      const match = e.match(/^(\w+)=(.+)$/);
      if (match) {
        const key = match[1];
        const val = resolveTemplateString(match[2], resolved);
        lines.push(`${key}=${val.includes("***") ? "<SET_ME>" : val}`);
      }
    }
  }
  return lines.join("\n");
}

// ── Template string resolution ─────────────────────────

function resolveTemplateString(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

export function resolveTemplateForExisting(
  template: TemplateDefinition,
  existingComposePath: string,
  userInputs: Record<string, string>
): ResolvedTemplate & { backupPath: string; diff: string[] } {
  const resolved = resolveTemplate(template, userInputs);
  const backupPath = `${existingComposePath}.bak-${Date.now()}`;

  // Basic diff: what changes from the existing setup
  const diff: string[] = [];
  diff.push(`Add ${template.reverse_proxy.type} reverse proxy config`);
  for (const svc of template.services) {
    if (svc.healthcheck) diff.push(`Add healthcheck to ${svc.name}`);
    if (svc.restart) diff.push(`Set restart policy for ${svc.name}`);
  }
  if (template.volumes?.length) diff.push(`Add ${template.volumes.length} persistent volume(s)`);
  if (template.inputs.some(i => i.generate)) diff.push(`Generate secure secrets`);

  return { ...resolved, backupPath, diff };
}

// ── Preview ────────────────────────────────────────────

export function generatePreview(resolved: ResolvedTemplate): string {
  const t = resolved.definition;
  const lines = [
    `# ${t.name} v${t.version}`,
    `# ${t.description}`,
    ``,
    `## What will be created`,
    ``,
  ];
  if (t.reverse_proxy.sites?.length) {
    for (const site of t.reverse_proxy.sites) {
      const domain = resolveTemplateString(site.domain, resolved.inputs);
      lines.push(`  • Reverse proxy site: ${domain}`);
    }
  }
  lines.push("");
  lines.push("## Services");
  for (const svc of t.services) {
    const name = resolveTemplateString(svc.name, resolved.inputs);
    const img = svc.image ? resolveTemplateString(svc.image, resolved.inputs) : "built from source";
    lines.push(`  • ${name}: ${img}`);
  }
  if (t.volumes?.length) {
    lines.push("");
    lines.push("## Volumes");
    for (const v of t.volumes) lines.push(`  • ${resolveTemplateString(v, resolved.inputs)}`);
  }
  lines.push("");
  lines.push("## Configuration files");
  lines.push(`  • docker-compose.yml`);
  lines.push(`  • ${resolved.proxyConfigPath}`);
  lines.push(`  • .env.schema`);
  lines.push("");
  lines.push("## Resolved inputs");
  for (const [k, v] of Object.entries(resolved.inputs)) {
    lines.push(`  • ${k}: ${v.includes("***") ? "***" : v}`);
  }

  return lines.join("\n");
}
