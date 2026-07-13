import type { Project } from "@prisma/client";
import { parse } from "yaml";
import {
  execOnVps,
  getDockerComposeCommand,
  shQuote,
  type VpsConnection,
} from "./vps";
import { maskSecret, parseDotenv } from "./env-management";

export interface DiscoveredEnvEntry {
  key: string;
  source: string;
  scope: "deployment" | "component";
  component?: string;
  container?: string;
  state?: string;
  runtime?: boolean;
  resolved?: boolean;
  masked: string;
  hasValue: boolean;
}

export interface DiscoveredEnvResult {
  entries: DiscoveredEnvEntry[];
  values: Record<string, string>;
  scopedValues: Record<string, string>;
  summary: {
    containerCount: number;
    runningContainerCount: number;
    runtimeKeyCount: number;
    declaredKeyCount: number;
  };
}

export interface RuntimeEnvDiscovery {
  entries: DiscoveredEnvEntry[];
  values: Record<string, string>;
  scopedValues: Record<string, string>;
  containerCount: number;
  runningContainerCount: number;
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
  const scopedValues: Record<string, string> = {};
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
    scopedValues[key] = value;
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
      scopedValues[scopedEnvKey(ref.component, key)] = value;
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

  // `docker compose config` resolves interpolation and env_file precedence for
  // the next deployment. It is more accurate than parsing the source YAML but
  // still distinct from what is already running.
  const resolvedCompose = await readResolvedComposeConfig(projectPath, vps);
  for (const item of discoverComposeEnvValuesByService(resolvedCompose)) {
    values[item.key] = item.value;
    scopedValues[scopedEnvKey(item.component, item.key)] = item.value;
    addEntry(entries, seen, {
      key: item.key,
      source: "compose resolved",
      scope: "component",
      component: item.component,
      resolved: true,
      masked: maskSecret(item.value),
      hasValue: !!item.value,
    });
  }

  // Container inspection is the final authority for the environment that is
  // running now. Runtime values deliberately win over files and resolved
  // Compose values in the effective map.
  const runtime = await readRuntimeContainerEnv(projectPath, vps);
  for (const entry of runtime.entries) addEntry(entries, seen, entry);
  Object.assign(values, runtime.values);
  Object.assign(scopedValues, runtime.scopedValues);

  const declaredKeyCount = new Set(
    entries.filter((entry) => !entry.runtime).map((entry) => entry.key)
  ).size;

  return {
    entries: entries.sort((a, b) => a.key.localeCompare(b.key)),
    values,
    scopedValues,
    summary: {
      containerCount: runtime.containerCount,
      runningContainerCount: runtime.runningContainerCount,
      runtimeKeyCount: Object.keys(runtime.scopedValues).length,
      declaredKeyCount,
    },
  };
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

function discoverComposeEnvValuesByService(
  composeContent: string
): Array<{ component: string; key: string; value: string }> {
  let doc: Record<string, unknown> | null = null;
  try {
    doc = parse(composeContent) as Record<string, unknown> | null;
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object" || !doc.services || typeof doc.services !== "object" || Array.isArray(doc.services)) {
    return [];
  }
  const found: Array<{ component: string; key: string; value: string }> = [];
  for (const [component, raw] of Object.entries(doc.services as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const env = (raw as Record<string, unknown>).environment;
    if (Array.isArray(env)) {
      for (const entry of env) {
        const [key, ...rest] = String(entry || "").split("=");
        if (key && rest.length > 0) found.push({ component, key, value: rest.join("=") });
      }
    } else if (env && typeof env === "object") {
      for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
        if (value !== null && value !== undefined) found.push({ component, key, value: String(value) });
      }
    }
  }
  return found;
}

export function discoverRuntimeEnvFromInspectContent(
  content: string,
  processEnvByContainerId: Record<string, Record<string, string>> = {}
): RuntimeEnvDiscovery {
  let containers: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(content || "[]") as unknown;
    containers = Array.isArray(parsed)
      ? parsed.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      : [];
  } catch {
    return emptyRuntimeDiscovery();
  }

  const entries: DiscoveredEnvEntry[] = [];
  const values: Record<string, string> = {};
  const scopedValues: Record<string, string> = {};
  let runningContainerCount = 0;

  for (const container of containers) {
    const config = asRecord(container.Config);
    const labels = asRecord(config.Labels);
    const state = asRecord(container.State);
    const containerId = String(container.Id || "");
    const component = String(labels["com.docker.compose.service"] || "").trim() || undefined;
    const containerName = String(container.Name || "").replace(/^\//, "") || undefined;
    const stateLabel = String(state.Status || (state.Running ? "running" : "unknown"));
    if (state.Running === true) runningContainerCount += 1;

    const processEnv = containerId ? processEnvByContainerId[containerId] : undefined;
    const configuredEnv = Object.fromEntries(
      (Array.isArray(config.Env) ? config.Env : []).flatMap((raw) => {
        const [key, ...rest] = String(raw || "").split("=");
        return key && rest.length > 0 ? [[key, rest.join("=")]] : [];
      })
    );
    const effectiveEnv = state.Running === true && processEnv
      ? processEnv
      : configuredEnv;
    const source = state.Running === true && processEnv
      ? "running process"
      : state.Running === true
        ? "running container"
        : "container configuration";

    for (const [key, value] of Object.entries(effectiveEnv)) {
      values[key] = value;
      scopedValues[scopedEnvKey(component, key)] = value;
      entries.push({
        key,
        source,
        scope: component ? "component" : "deployment",
        component,
        container: containerName,
        state: stateLabel,
        runtime: state.Running === true,
        masked: maskSecret(value),
        hasValue: !!value,
      });
    }
  }

  return {
    entries,
    values,
    scopedValues,
    containerCount: containers.length,
    runningContainerCount,
  };
}

export function parseProcessEnvSnapshotContent(content: string): Record<string, Record<string, string>> {
  const snapshots: Record<string, Record<string, string>> = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const separator = line.indexOf("\t");
    if (separator <= 0) continue;
    const containerId = line.slice(0, separator).trim();
    const encoded = line.slice(separator + 1).trim();
    if (!containerId || !encoded) continue;
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const values: Record<string, string> = {};
      for (const raw of decoded.split("\0")) {
        const equals = raw.indexOf("=");
        if (equals <= 0) continue;
        values[raw.slice(0, equals)] = raw.slice(equals + 1);
      }
      snapshots[containerId] = values;
    } catch {
      // Ignore malformed or unavailable process snapshots and use Docker config.
    }
  }
  return snapshots;
}

async function readResolvedComposeConfig(
  projectPath: string,
  vps?: VpsConnection | null
): Promise<string> {
  if (!projectPath) return "";
  const compose = await getDockerComposeCommand(vps);
  const command = [
    `cd ${shQuote(projectPath)} 2>/dev/null || exit 0`,
    `${compose} config --format json 2>/dev/null || ${compose} config 2>/dev/null || true`,
  ].join("\n");
  const result = await execOnVps(command, vps);
  return result.stdout || "";
}

async function readRuntimeContainerEnv(
  projectPath: string,
  vps?: VpsConnection | null
): Promise<RuntimeEnvDiscovery> {
  if (!projectPath) return emptyRuntimeDiscovery();
  const compose = await getDockerComposeCommand(vps);
  const command = [
    `cd ${shQuote(projectPath)} 2>/dev/null || exit 0`,
    `ids=$(${compose} ps -q 2>/dev/null || true)`,
    `if [ -z "$ids" ]; then printf '[]'; else docker inspect $ids 2>/dev/null || printf '[]'; fi`,
    `printf '\n__GC_PROCESS_ENV__\n'`,
    `for id in $ids; do`,
    `  pid=$(docker inspect -f '{{.State.Pid}}' "$id" 2>/dev/null || printf '0')`,
    `  if [ "$pid" -gt 0 ] 2>/dev/null && [ -r "/proc/$pid/environ" ]; then`,
    `    printf '%s\t' "$id"`,
    `    base64 < "/proc/$pid/environ" 2>/dev/null | tr -d '\n'`,
    `    printf '\n'`,
    `  fi`,
    `done`,
  ].join("\n");
  const result = await execOnVps(command, vps);
  const [inspectContent, processContent = ""] = (result.stdout || "[]").split("\n__GC_PROCESS_ENV__\n", 2);
  return discoverRuntimeEnvFromInspectContent(
    inspectContent,
    parseProcessEnvSnapshotContent(processContent)
  );
}

function emptyRuntimeDiscovery(): RuntimeEnvDiscovery {
  return {
    entries: [],
    values: {},
    scopedValues: {},
    containerCount: 0,
    runningContainerCount: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function scopedEnvKey(component: string | undefined, key: string): string {
  return component ? `${component}:${key}` : key;
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
