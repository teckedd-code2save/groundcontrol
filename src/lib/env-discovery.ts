import type { Project } from "@prisma/client";
import { parse } from "yaml";
import { execOnVps, shQuote, type VpsConnection } from "./vps";
import { maskSecret, parseDotenv } from "./env-management";

export interface DiscoveredEnvEntry {
  key: string;
  source: string;
  scope: "deployment" | "component";
  component?: string;
  masked: string;
  hasValue: boolean;
}

export interface DiscoveredEnvResult {
  entries: DiscoveredEnvEntry[];
  values: Record<string, string>;
}

export function discoverEnvFromComposeContent(composeContent: string): DiscoveredEnvEntry[] {
  let doc: Record<string, unknown> | null = null;
  try {
    doc = parse(composeContent) as Record<string, unknown> | null;
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object" || !doc.services || typeof doc.services !== "object" || Array.isArray(doc.services)) {
    return [];
  }
  const entries: DiscoveredEnvEntry[] = [];
  for (const [component, raw] of Object.entries(doc.services as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const service = raw as Record<string, unknown>;
    for (const key of environmentKeys(service.environment)) {
      entries.push({ key, source: "compose", scope: "component", component, masked: "", hasValue: false });
    }
  }
  return entries;
}

export async function discoverProjectEnv(
  project: Project,
  vps?: VpsConnection | null
): Promise<DiscoveredEnvResult> {
  const values: Record<string, string> = {};
  const entries: DiscoveredEnvEntry[] = [];
  const seen = new Set<string>();
  const projectPath = project.path.replace(/\/+$/, "");

  const composeContent = project.dockerCompose || await readRemoteFile(`${projectPath}/docker-compose.yml`, vps);
  const composeEntries = discoverEnvFromComposeContent(composeContent);
  for (const entry of composeEntries) {
    addEntry(entries, seen, entry);
  }
  for (const [key, value] of Object.entries(discoverComposeEnvValues(composeContent))) {
    values[key] = value;
    const existing = entries.find((entry) => entry.key === key && entry.source === "compose");
    if (existing) {
      existing.masked = maskSecret(value);
      existing.hasValue = !!value;
    }
  }

  const rootEnv = await readRemoteFile(`${projectPath}/.env`, vps);
  for (const [key, value] of Object.entries(parseDotenv(rootEnv))) {
    values[key] = value;
    addEntry(entries, seen, {
      key,
      source: ".env",
      scope: "deployment",
      masked: maskSecret(value),
      hasValue: !!value,
    });
  }

  const envFileRefs = envFileReferences(composeContent);
  for (const ref of envFileRefs) {
    const path = ref.path.startsWith("/") ? ref.path : `${projectPath}/${ref.path}`;
    const content = await readRemoteFile(path, vps);
    for (const [key, value] of Object.entries(parseDotenv(content))) {
      values[key] = value;
      addEntry(entries, seen, {
        key,
        source: ref.path,
        scope: "component",
        component: ref.component,
        masked: maskSecret(value),
        hasValue: !!value,
      });
    }
  }

  return { entries: entries.sort((a, b) => a.key.localeCompare(b.key)), values };
}

function addEntry(entries: DiscoveredEnvEntry[], seen: Set<string>, entry: DiscoveredEnvEntry) {
  const id = `${entry.key}:${entry.source}:${entry.component || ""}`;
  if (seen.has(id)) return;
  seen.add(id);
  entries.push(entry);
}

async function readRemoteFile(path: string, vps?: VpsConnection | null): Promise<string> {
  const result = await execOnVps(`cat ${shQuote(path)} 2>/dev/null || true`, vps);
  return result.stdout || "";
}

function environmentKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").split("=")[0]?.trim()).filter(Boolean);
  }
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>);
  return [];
}

function discoverComposeEnvValues(composeContent: string): Record<string, string> {
  let doc: Record<string, unknown> | null = null;
  try {
    doc = parse(composeContent) as Record<string, unknown> | null;
  } catch {
    return {};
  }
  if (!doc || typeof doc !== "object" || !doc.services || typeof doc.services !== "object" || Array.isArray(doc.services)) {
    return {};
  }
  const values: Record<string, string> = {};
  for (const raw of Object.values(doc.services as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const env = (raw as Record<string, unknown>).environment;
    if (Array.isArray(env)) {
      for (const entry of env) {
        const [key, ...rest] = String(entry || "").split("=");
        if (key && rest.length > 0) values[key] = rest.join("=");
      }
    } else if (env && typeof env === "object") {
      for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
        if (value !== null && value !== undefined) values[key] = String(value);
      }
    }
  }
  return values;
}

function envFileReferences(composeContent: string): { path: string; component?: string }[] {
  let doc: Record<string, unknown> | null = null;
  try {
    doc = parse(composeContent) as Record<string, unknown> | null;
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object" || !doc.services || typeof doc.services !== "object" || Array.isArray(doc.services)) {
    return [];
  }
  return Object.entries(doc.services as Record<string, unknown>).flatMap(([component, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    return stringList((raw as Record<string, unknown>).env_file).map((path) => ({ path, component }));
  });
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map((entry) => String(entry || "")).filter(Boolean);
  return [];
}
