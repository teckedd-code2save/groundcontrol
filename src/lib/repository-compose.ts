import { parse } from "yaml";

export interface RepositoryComposeEnvironment {
  key: string;
  required: boolean;
  defaultValue?: string;
  message?: string;
}

export interface RepositoryComposePublishedPort {
  service: string;
  hostPort: string;
  containerPort: string;
  hostIp?: string;
}

export interface RepositoryComposeInspection {
  services: string[];
  publishedPorts: RepositoryComposePublishedPort[];
  environment: RepositoryComposeEnvironment[];
  suggestedPublicService?: string;
  suggestedPublicPort?: string;
  suggestedHealthPath?: string;
}

type ComposeRecord = Record<string, unknown>;

export function normalizeRepositoryComposePath(value?: string | null): string {
  const path = String(value || "docker-compose.yml").trim().replace(/^\.\/+/, "");
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "..")) {
    throw new Error("Compose file must be a repository-relative path without '..'.");
  }
  if (!/ya?ml$/i.test(path)) {
    throw new Error("Compose file must be a YAML file.");
  }
  return path;
}

export function inspectRepositoryCompose(content: string): RepositoryComposeInspection {
  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Compose YAML is invalid");
  }

  const document = asRecord(parsed);
  const servicesRecord = asRecord(document.services);
  const services = Object.keys(servicesRecord);
  if (services.length === 0) {
    throw new Error("Compose file must declare at least one service.");
  }

  const publishedPorts: RepositoryComposePublishedPort[] = [];
  for (const [service, rawService] of Object.entries(servicesRecord)) {
    const definition = asRecord(rawService);
    const ports = Array.isArray(definition.ports) ? definition.ports : [];
    for (const rawPort of ports) {
      const port = parsePublishedPort(service, rawPort);
      if (port) publishedPorts.push(port);
    }
  }

  const environment = extractComposeEnvironment(content);
  const preferred = publishedPorts.find((port) => /^(gateway|web|app|frontend|studio)$/i.test(port.service))
    || publishedPorts[0];
  const preferredDefinition = preferred ? asRecord(servicesRecord[preferred.service]) : {};
  const healthcheck = asRecord(preferredDefinition.healthcheck);
  const healthCommand = Array.isArray(healthcheck.test)
    ? healthcheck.test.map(String).join(" ")
    : scalar(healthcheck.test);
  const healthUrl = healthCommand.match(/https?:\/\/[^/\s"'`]+(\/[^\s"'`\]]*)?/i);

  return {
    services,
    publishedPorts,
    environment,
    suggestedPublicService: preferred?.service,
    suggestedPublicPort: preferred?.hostPort,
    suggestedHealthPath: healthUrl?.[1] || undefined,
  };
}

export function repositoryComposeEnvSchema(environment: RepositoryComposeEnvironment[]): string {
  const lines = ["# Environment variables discovered from the repository Compose file"];
  for (const entry of environment) {
    lines.push(`${entry.key}=${entry.required ? "<SET_ME>" : entry.defaultValue || ""}`);
  }
  return lines.join("\n");
}

function extractComposeEnvironment(content: string): RepositoryComposeEnvironment[] {
  const found = new Map<string, RepositoryComposeEnvironment>();
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:\?|\?|:-|-)([^}]*))?\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const [, key, operator, operand = ""] = match;
    const required = !operator || operator === ":?" || operator === "?";
    const candidate: RepositoryComposeEnvironment = {
      key,
      required,
      defaultValue: required ? undefined : operand,
      message: operator === ":?" || operator === "?" ? operand || undefined : undefined,
    };
    const existing = found.get(key);
    if (!existing || (candidate.required && !existing.required)) found.set(key, candidate);
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function parsePublishedPort(service: string, value: unknown): RepositoryComposePublishedPort | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as ComposeRecord;
    const hostPort = scalar(record.published);
    const containerPort = scalar(record.target);
    if (!hostPort || !containerPort) return null;
    return {
      service,
      hostPort,
      containerPort,
      hostIp: scalar(record.host_ip) || undefined,
    };
  }

  const resolved = String(value || "")
    .replace(/\/(tcp|udp)$/i, "")
    .replace(/\$\{[A-Za-z_][A-Za-z0-9_]*(?::-|-)([^}]*)\}/g, "$1")
    .replace(/\$\{[^}]+\}/g, "");
  const match = resolved.match(/^(?:(.+):)?(\d+):(\d+)$/);
  if (!match) return null;
  const hostPrefix = match[1] || "";
  const hostIp = hostPrefix && !/^\d+$/.test(hostPrefix) ? hostPrefix : undefined;
  const hostPort = hostIp ? match[2] : hostPrefix || match[2];
  return {
    service,
    hostPort,
    containerPort: match[3],
    hostIp,
  };
}

function asRecord(value: unknown): ComposeRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ComposeRecord : {};
}

function scalar(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
