import { createHash } from "crypto";
import type { DeploymentEnvProfile, EnvProviderAccount, Project } from "@prisma/client";
import { prisma } from "./prisma";
import { decryptMaybe, encryptIfNeeded } from "./crypto";
import { execOnTarget } from "./host-exec";
import { getActiveVps, shQuote, type VpsConnection } from "./vps";
import {
  decryptInfisicalCredentials,
  encryptInfisicalCredentials,
  listInfisicalSecrets,
  type InfisicalProviderConfig,
} from "./infisical";

export interface EnvSchemaEntry {
  key: string;
  required: boolean;
  defaultValue?: string;
}

export interface EnvValidationResult {
  ok: boolean;
  missing: string[];
  hash: string;
}

export interface ResolvedDeploymentEnv {
  profile: DeploymentEnvProfile;
  provider?: EnvProviderAccount | null;
  values: Record<string, string>;
  validation: EnvValidationResult;
}

export function parseEnvSchema(content?: string | null): EnvSchemaEntry[] {
  const seen = new Set<string>();
  const entries: EnvSchemaEntry[] = [];
  for (const raw of String(content || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    entries.push({
      key,
      required: true,
      defaultValue: value && value !== "<SET_ME>" ? value : undefined,
    });
  }
  return entries;
}

export function parseEnvJson(value?: string | null): EnvSchemaEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as EnvSchemaEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry.key) : [];
  } catch {
    return parseEnvSchema(value);
  }
}

export function parseDotenv(content?: string | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of String(content || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

export function serializeDotenv(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .map((key) => `${key}=${escapeEnvValue(values[key] || "")}`)
    .join("\n") + "\n";
}

function escapeEnvValue(value: string): string {
  if (/[\n\r#\s"'\\]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export function maskSecret(value?: string | null): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return "•".repeat(value.length - 4) + value.slice(-4);
}

export function hashEnv(values: Record<string, string>): string {
  return createHash("sha256").update(serializeDotenv(values)).digest("hex");
}

export function validateEnv(schema: EnvSchemaEntry[], values: Record<string, string>): EnvValidationResult {
  const missing = schema.filter((entry) => entry.required && !values[entry.key]).map((entry) => entry.key);
  return { ok: missing.length === 0, missing, hash: hashEnv(values) };
}

export async function ensureLocalEnvProvider() {
  const existing = await prisma.envProviderAccount.findFirst({ where: { provider: "local", isActive: true } });
  if (existing) return existing;
  const fallback = await prisma.envProviderAccount.findFirst({ where: { provider: "local" } });
  if (fallback) {
    return prisma.envProviderAccount.update({ where: { id: fallback.id }, data: { isActive: true } });
  }
  return prisma.envProviderAccount.create({
    data: {
      name: "Local encrypted .env",
      provider: "local",
      configJson: JSON.stringify({ description: "Encrypted values stored by GroundControl" }),
      credentials: "",
      isActive: true,
    },
  });
}

export async function upsertEnvProfileForProject(input: {
  projectId: number;
  deploymentId?: number | null;
  schema?: EnvSchemaEntry[];
  providerType?: string;
  providerAccountId?: number | null;
  environment?: string;
  secretPath?: string;
  projectRef?: string;
}) {
  const providerType = input.providerType || "local";
  const providerAccount = input.providerAccountId
    ? await prisma.envProviderAccount.findUnique({ where: { id: input.providerAccountId } })
    : providerType === "local"
      ? await ensureLocalEnvProvider()
      : null;
  const existing = await prisma.deploymentEnvProfile.findFirst({
    where: { projectId: input.projectId },
    orderBy: { updatedAt: "desc" },
  });
  const data = {
    deploymentId: input.deploymentId ?? existing?.deploymentId ?? null,
    providerType,
    providerAccountId: providerAccount?.id ?? input.providerAccountId ?? null,
    environment: input.environment || existing?.environment || "prod",
    secretPath: input.secretPath || existing?.secretPath || "/",
    projectRef: input.projectRef || existing?.projectRef || "",
    schemaJson: JSON.stringify(input.schema || parseEnvJson(existing?.schemaJson)),
  };
  if (existing) {
    return prisma.deploymentEnvProfile.update({ where: { id: existing.id }, data });
  }
  return prisma.deploymentEnvProfile.create({ data: { projectId: input.projectId, ...data } });
}

export async function setLocalEnvValues(
  profileId: number,
  values: Record<string, string>,
  schema: EnvSchemaEntry[] = []
) {
  const required = new Set(schema.filter((entry) => entry.required).map((entry) => entry.key));
  for (const [key, value] of Object.entries(values)) {
    await prisma.deploymentEnvValue.upsert({
      where: { profileId_key: { profileId, key } },
      create: {
        profileId,
        key,
        value: encryptIfNeeded(value) || "",
        required: required.has(key),
        source: "local",
      },
      update: {
        value: encryptIfNeeded(value) || "",
        required: required.has(key),
        source: "local",
      },
    });
  }
}

export async function getProfileValues(profileId: number): Promise<Record<string, string>> {
  const rows = await prisma.deploymentEnvValue.findMany({ where: { profileId } });
  return Object.fromEntries(rows.map((row) => [row.key, decryptMaybe(row.value) || ""]));
}

function parseConfig<T>(value?: string | null): T {
  try {
    return JSON.parse(value || "{}") as T;
  } catch {
    return {} as T;
  }
}

export async function resolveDeploymentEnv(project: Project): Promise<ResolvedDeploymentEnv | null> {
  const profile = await prisma.deploymentEnvProfile.findFirst({
    where: { projectId: project.id },
    orderBy: { updatedAt: "desc" },
  });
  if (!profile) return null;
  const provider = profile.providerAccountId
    ? await prisma.envProviderAccount.findUnique({ where: { id: profile.providerAccountId } })
    : null;
  const schema = parseEnvJson(profile.schemaJson);
  let values: Record<string, string> = {};
  if (profile.providerType === "infisical") {
    if (!provider) throw new Error("Infisical env profile has no provider account");
    const config = {
      ...parseConfig<InfisicalProviderConfig>(provider.configJson),
      projectId: profile.projectRef || parseConfig<InfisicalProviderConfig>(provider.configJson).projectId,
      environment: profile.environment,
      secretPath: profile.secretPath,
    };
    values = normalizeProviderRuntimeEnv(
      await listInfisicalSecrets(config, decryptInfisicalCredentials(provider.credentials)),
      "infisical"
    );
  } else {
    values = await getProfileValues(profile.id);
  }
  const validation = validateEnv(schema, values);
  return { profile, provider, values, validation };
}

export function normalizeProviderRuntimeEnv(values: Record<string, string>, providerType: string): Record<string, string> {
  if (providerType !== "infisical") return values;
  const next = { ...values };
  for (const [key, value] of Object.entries(values)) {
    const alias = key.match(/^sec[_.-]([A-Za-z_][A-Za-z0-9_]*)$/i)?.[1];
    if (alias && next[alias] === undefined) next[alias] = value;
  }
  return next;
}

export function buildMaterializeEnvCommand(deployPath: string, envContent: string): string {
  const quotedPath = shQuote(deployPath);
  const backupName = `.groundcontrol/env-backups/.env.$(date +%Y%m%d%H%M%S).bak`;
  return [
    `set -eu`,
    `mkdir -p ${quotedPath}/.groundcontrol/env-backups`,
    `cd ${quotedPath}`,
    `cat > .env.new << 'GCEOF'`,
    envContent.replace(/\n?$/, "\n") + `GCEOF`,
    `chmod 600 .env.new`,
    `if [ -f .env ]; then cp .env ${backupName}; fi`,
    `mv .env.new .env`,
    `chmod 600 .env`,
    `sha256sum .env 2>/dev/null | awk '{print $1}' || shasum -a 256 .env | awk '{print $1}'`,
  ].join("\n");
}

export async function materializeEnvFile(
  deployPath: string,
  values: Record<string, string>,
  vps?: VpsConnection | null
) {
  const content = serializeDotenv(values);
  const conn = vps || (await getActiveVps());
  const result = await execOnTarget(buildMaterializeEnvCommand(deployPath, content), conn);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to write .env");
  }
  return { hash: hashEnv(values), output: result.stdout.trim() };
}

export async function applyEnvToDeployment(
  project: Project,
  deploymentId?: number,
  log?: (chunk: string) => void,
  options: { materialize?: boolean } = {}
) {
  const resolved = await resolveDeploymentEnv(project);
  if (!resolved) return null;
  if (!resolved.validation.ok) {
    throw new Error(`Missing required env keys: ${resolved.validation.missing.join(", ")}`);
  }
  if (options.materialize !== false && project.path) {
    await materializeEnvFile(project.path, resolved.values);
    log?.(`[env] materialized ${resolved.profile.providerType} env to ${project.path}/.env\n`);
  }
  await prisma.deploymentEnvProfile.update({
    where: { id: resolved.profile.id },
    data: {
      status: "synced",
      lastHash: resolved.validation.hash,
      lastSyncedAt: new Date(),
      lastError: null,
      deploymentId: deploymentId ?? resolved.profile.deploymentId,
    },
  });
  return resolved;
}

export function publicProfile(profile: DeploymentEnvProfile, values: Record<string, string>, schema: EnvSchemaEntry[]) {
  const validation = validateEnv(schema, values);
  return {
    ...profile,
    schema,
    validation,
    values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { masked: maskSecret(value), hasValue: !!value }])),
  };
}

export { encryptInfisicalCredentials };
