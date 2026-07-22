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
import {
  MANAGED_ENV_FILES_MANIFEST,
  MANAGED_ENV_OVERRIDE_FILE,
} from "./compose-management";

export interface EnvSchemaEntry {
  key: string;
  required: boolean;
  component?: string;
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
  componentValues: Record<string, Record<string, string>>;
  validation: EnvValidationResult;
}

export type EnvRuntimeStatus = "materialized" | "not-materialized" | "not-required" | "unavailable";

export interface EnvRuntimeReadiness {
  status: EnvRuntimeStatus;
  missingScopes: string[];
}

export function normalizeEnvironmentSlug(value?: string | null): string {
  const slug = String(value || "production")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "production";
}

export function managedEnvRuntimeDirectory(deployPath: string, environmentSlug?: string | null): string {
  const namespace = createHash("sha256").update(deployPath).digest("hex").slice(0, 16);
  return `/run/groundcontrol/environments/${namespace}/${normalizeEnvironmentSlug(environmentSlug)}`;
}

export async function inspectMaterializedEnvBundle(
  deployPath: string,
  environmentSlug: string,
  values: Record<string, string>,
  componentValues: Record<string, Record<string, string>>,
  vps?: VpsConnection | null
): Promise<EnvRuntimeReadiness> {
  const runtimeDir = managedEnvRuntimeDirectory(deployPath, environmentSlug);
  const componentScopes = Object.keys(componentValues)
    .filter(isSafeComposeServiceName)
    .filter((component) => Object.keys(componentValues[component]).length > 0)
    .sort();
  const checks = [
    ...(Object.keys(values).length > 0 ? [{ scope: "deployment", path: `${deployPath}/.env` }] : []),
    ...componentScopes.map((component) => ({ scope: component, path: `${runtimeDir}/${component}.env` })),
    ...(componentScopes.length > 0 ? [
      { scope: "runtime manifest", path: `${deployPath}/${MANAGED_ENV_FILES_MANIFEST}` },
      { scope: "Compose environment overlay", path: `${deployPath}/${MANAGED_ENV_OVERRIDE_FILE}` },
    ] : []),
  ];
  if (checks.length === 0) return { status: "not-required", missingScopes: [] };

  const command = checks.map(({ scope, path }) => (
    `[ -f ${shQuote(path)} ] || printf '%s\\n' ${shQuote(scope)}`
  )).join("\n");
  try {
    const result = await execOnTarget(command, vps || (await getActiveVps()));
    const missingScopes = result.stdout.split("\n").map((item) => item.trim()).filter(Boolean);
    return {
      status: missingScopes.length === 0 ? "materialized" : "not-materialized",
      missingScopes,
    };
  } catch {
    return { status: "unavailable", missingScopes: [] };
  }
}

export function environmentDisplayName(value?: string | null): string {
  const slug = normalizeEnvironmentSlug(value);
  if (slug === "prod" || slug === "production") return "Production";
  if (slug === "stage" || slug === "staging") return "Staging";
  if (slug === "dev" || slug === "development") return "Development";
  return slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function environmentExportFilename(
  projectSlug: string,
  environmentSlug: string,
  component?: string | null
): string {
  const safe = (value: string) => value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return [
    safe(projectSlug) || "deployment",
    safe(environmentSlug) || "environment",
    safe(component || "") || "shared",
    "env",
    "txt",
  ].join(".");
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
      required: false,
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
      name: "GroundControl Vault",
      provider: "local",
      configJson: JSON.stringify({ description: "Version-ready encrypted values stored by GroundControl" }),
      credentials: "",
      isActive: true,
    },
  });
}

export async function upsertEnvProfileForProject(input: {
  projectId: number;
  profileId?: number | null;
  deploymentId?: number | null;
  name?: string;
  environmentSlug?: string;
  isDefault?: boolean;
  schema?: EnvSchemaEntry[];
  providerType?: string;
  providerAccountId?: number | null;
  environment?: string;
  secretPath?: string;
  projectRef?: string;
}) {
  const requestedSlug = input.environmentSlug ? normalizeEnvironmentSlug(input.environmentSlug) : null;
  const existing = input.profileId
    ? await prisma.deploymentEnvProfile.findFirst({ where: { id: input.profileId, projectId: input.projectId } })
    : requestedSlug
      ? await prisma.deploymentEnvProfile.findFirst({ where: { projectId: input.projectId, slug: requestedSlug } })
      : await prisma.deploymentEnvProfile.findFirst({
          where: { projectId: input.projectId },
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
        });
  const slug = requestedSlug || existing?.slug || "production";
  const providerType = input.providerType || existing?.providerType || "local";
  const providerAccount = input.providerAccountId
    ? await prisma.envProviderAccount.findUnique({ where: { id: input.providerAccountId } })
    : providerType === "local"
      ? await ensureLocalEnvProvider()
      : null;
  const data = {
    deploymentId: input.deploymentId ?? existing?.deploymentId ?? null,
    name: input.name?.trim() || existing?.name || environmentDisplayName(slug),
    slug,
    isDefault: input.isDefault ?? existing?.isDefault ?? !(await prisma.deploymentEnvProfile.count({
      where: { projectId: input.projectId },
    })),
    providerType,
    providerAccountId: providerAccount?.id ?? input.providerAccountId ?? null,
    environment: input.environment || existing?.environment || "prod",
    secretPath: input.secretPath || existing?.secretPath || "/",
    projectRef: input.projectRef || existing?.projectRef || "",
    schemaJson: JSON.stringify(input.schema || parseEnvJson(existing?.schemaJson)),
  };
  if (data.isDefault) {
    await prisma.deploymentEnvProfile.updateMany({
      where: { projectId: input.projectId, ...(existing ? { id: { not: existing.id } } : {}) },
      data: { isDefault: false },
    });
  }
  if (existing) {
    return prisma.deploymentEnvProfile.update({ where: { id: existing.id }, data });
  }
  return prisma.deploymentEnvProfile.create({ data: { projectId: input.projectId, ...data } });
}

export async function listDeploymentEnvironments(projectId: number) {
  return prisma.deploymentEnvProfile.findMany({
    where: { projectId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function setLocalEnvValues(
  profileId: number,
  values: Record<string, string>,
  schema: EnvSchemaEntry[] = [],
  component = ""
) {
  const required = new Set(
    schema
      .filter((entry) => entry.required && (entry.component || "") === component)
      .map((entry) => entry.key)
  );
  for (const [key, value] of Object.entries(values)) {
    const encryptedValue = encryptIfNeeded(value) || "";
    const latest = await prisma.deploymentEnvValueVersion.aggregate({
      where: { profileId, component, key },
      _max: { version: true },
    });
    const version = (latest._max.version || 0) + 1;
    await prisma.$transaction([
      prisma.deploymentEnvValueVersion.create({
        data: { profileId, component, key, value: encryptedValue, version, state: "active", source: "local" },
      }),
      prisma.deploymentEnvValue.upsert({
        where: { profileId_component_key: { profileId, component, key } },
        create: {
          profileId,
          component,
          key,
          value: encryptedValue,
          required: required.has(key),
          source: "local",
          version,
        },
        update: {
          value: encryptedValue,
          required: required.has(key),
          source: "local",
          version,
        },
      }),
    ]);
  }
}

export async function deleteLocalEnvValues(profileId: number, keys: string[], component = "") {
  if (keys.length === 0) return { count: 0 };
  const existing = await prisma.deploymentEnvValue.findMany({
    where: { profileId, component, key: { in: keys } },
  });
  for (const row of existing) {
    const latest = await prisma.deploymentEnvValueVersion.aggregate({
      where: { profileId, component, key: row.key },
      _max: { version: true },
    });
    await prisma.deploymentEnvValueVersion.create({
      data: {
        profileId,
        component,
        key: row.key,
        value: "",
        version: (latest._max.version || row.version) + 1,
        state: "deleted",
        source: "local",
      },
    });
  }
  return prisma.deploymentEnvValue.deleteMany({ where: { profileId, component, key: { in: keys } } });
}

export async function getProfileValues(profileId: number): Promise<Record<string, string>> {
  const rows = await prisma.deploymentEnvValue.findMany({ where: { profileId, component: "" } });
  return Object.fromEntries(rows.map((row) => [row.key, decryptMaybe(row.value) || ""]));
}

export async function getProfileValuesByComponent(
  profileId: number
): Promise<Record<string, Record<string, string>>> {
  const rows = await prisma.deploymentEnvValue.findMany({
    where: { profileId, component: { not: "" } },
    orderBy: [{ component: "asc" }, { key: "asc" }],
  });
  const result: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    const values = result[row.component] || {};
    values[row.key] = decryptMaybe(row.value) || "";
    result[row.component] = values;
  }
  return result;
}

function parseConfig<T>(value?: string | null): T {
  try {
    return JSON.parse(value || "{}") as T;
  } catch {
    return {} as T;
  }
}

export async function resolveDeploymentEnv(
  project: Project,
  environmentSlug?: string
): Promise<ResolvedDeploymentEnv | null> {
  const profile = await prisma.deploymentEnvProfile.findFirst({
    where: {
      projectId: project.id,
      ...(environmentSlug ? { slug: normalizeEnvironmentSlug(environmentSlug) } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (!profile) return null;
  const provider = profile.providerAccountId
    ? await prisma.envProviderAccount.findUnique({ where: { id: profile.providerAccountId } })
    : null;
  const schema = parseEnvJson(profile.schemaJson);
  let values: Record<string, string> = {};
  let componentValues = await getProfileValuesByComponent(profile.id);
  if (profile.providerType === "infisical") {
    if (!provider) throw new Error("Infisical env profile has no provider account");
    const config = {
      ...parseConfig<InfisicalProviderConfig>(provider.configJson),
      projectId: profile.projectRef || parseConfig<InfisicalProviderConfig>(provider.configJson).projectId,
      environment: profile.environment,
      secretPath: profile.secretPath,
    };
    const providerValues = normalizeProviderRuntimeEnv(
      await listInfisicalSecrets(config, decryptInfisicalCredentials(provider.credentials)),
      "infisical"
    );
    values = Object.fromEntries(
      schema
        .filter((entry) => !entry.component && providerValues[entry.key] !== undefined)
        .map((entry) => [entry.key, providerValues[entry.key]])
    );
    componentValues = schema.reduce<Record<string, Record<string, string>>>((scoped, entry) => {
      if (!entry.component || providerValues[entry.key] === undefined) return scoped;
      scoped[entry.component] = {
        ...(scoped[entry.component] || {}),
        [entry.key]: providerValues[entry.key],
      };
      return scoped;
    }, {});
  } else {
    values = await getProfileValues(profile.id);
  }
  const validation = validateEnvBundle(schema, values, componentValues);
  return { profile, provider, values, componentValues, validation };
}

export function validateEnvBundle(
  schema: EnvSchemaEntry[],
  values: Record<string, string>,
  componentValues: Record<string, Record<string, string>>
): EnvValidationResult {
  const missing = schema.flatMap((entry) => {
    const source = entry.component ? componentValues[entry.component] || {} : values;
    return entry.required && !source[entry.key]
      ? [entry.component ? `${entry.component}:${entry.key}` : entry.key]
      : [];
  });
  return {
    ok: missing.length === 0,
    missing,
    hash: hashEnvBundle(values, componentValues),
  };
}

export function validateEnvForComponents(
  schema: EnvSchemaEntry[],
  values: Record<string, string>,
  componentValues: Record<string, Record<string, string>>,
  components: string[] = []
): EnvValidationResult {
  const scope = new Set(components);
  return validateEnvBundle(
    scope.size ? schema.filter((entry) => !entry.component || scope.has(entry.component)) : schema,
    values,
    componentValues
  );
}

export function removeEnvSchemaEntries(
  schema: EnvSchemaEntry[],
  keys: string[],
  component = ""
): EnvSchemaEntry[] {
  const removed = new Set(keys);
  return schema.filter((entry) => (
    (entry.component || "") !== component || !removed.has(entry.key)
  ));
}

export function hashEnvBundle(
  values: Record<string, string>,
  componentValues: Record<string, Record<string, string>>
): string {
  const content = [
    "[deployment]",
    serializeDotenv(values),
    ...Object.keys(componentValues).sort().flatMap((component) => [
      `[component:${component}]`,
      serializeDotenv(componentValues[component]),
    ]),
  ].join("\n");
  return createHash("sha256").update(content).digest("hex");
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
  return [
    `set -eu`,
    `cd ${quotedPath}`,
    `cat > .env.new << 'GCEOF'`,
    envContent.replace(/\n?$/, "\n") + `GCEOF`,
    `chmod 600 .env.new`,
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

export function buildMaterializeEnvBundleCommand(
  deployPath: string,
  values: Record<string, string>,
  componentValues: Record<string, Record<string, string>>,
  options: { pruneManagedFiles?: boolean; environmentSlug?: string } = {}
): string {
  const quotedPath = shQuote(deployPath);
  const environmentSlug = normalizeEnvironmentSlug(options.environmentSlug);
  const runtimeDir = managedEnvRuntimeDirectory(deployPath, environmentSlug);
  const quotedRuntimeDir = shQuote(runtimeDir);
  const commands = [
    "set -eu",
    `mkdir -p ${quotedPath}/.groundcontrol ${quotedRuntimeDir}`,
    `chmod 700 ${quotedRuntimeDir}`,
    `cd ${quotedPath}`,
    // The override is the last artifact written below. Removing it first means
    // Compose can never observe a half-materialized environment bundle.
    `rm -f ${shQuote(MANAGED_ENV_OVERRIDE_FILE)} ${shQuote(MANAGED_ENV_FILES_MANIFEST)}`,
    `find ${quotedRuntimeDir} -maxdepth 1 -type f -name '*.env' -delete 2>/dev/null || true`,
    "find .groundcontrol/env -maxdepth 1 -type f -name '*.env' -delete 2>/dev/null || true",
    "find .groundcontrol/env-backups -maxdepth 1 -type f -name '*.bak' -delete 2>/dev/null || true",
  ];
  if (Object.keys(values).length > 0 || options.pruneManagedFiles) {
    commands.push(...atomicEnvWriteCommands(".env", serializeDotenv(values)));
  }

  const components = Object.keys(componentValues)
    .filter(isSafeComposeServiceName)
    .filter((component) => Object.keys(componentValues[component]).length > 0)
    .sort();
  for (const component of components) {
    commands.push(...atomicEnvWriteCommands(
      `${runtimeDir}/${component}.env`,
      serializeDotenv(componentValues[component])
    ));
  }
  if (components.length > 0) {
    const runtimeFiles = components.map((component) => `${runtimeDir}/${component}.env`);
    const override = [
      "# Managed by GroundControl. Source values remain encrypted in GroundControl.",
      "services:",
      ...components.flatMap((component) => [
        `  ${component}:`,
        "    env_file:",
        `      - ${runtimeDir}/${component}.env`,
      ]),
      "",
    ].join("\n");
    commands.push(...atomicEnvWriteCommands(
      MANAGED_ENV_FILES_MANIFEST,
      runtimeFiles.join("\n") + "\n"
    ));
    commands.push(...atomicEnvWriteCommands(
      MANAGED_ENV_OVERRIDE_FILE,
      override
    ));
  }
  commands.push("printf '%s\\n' 'environment materialized'");
  return commands.join("\n");
}

function atomicEnvWriteCommands(path: string, content: string): string[] {
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const target = shQuote(path);
  return [
    `printf '%s' ${shQuote(encoded)} | base64 -d > ${target}.new`,
    `chmod 600 ${target}.new`,
    `mv ${target}.new ${target}`,
    `chmod 600 ${target}`,
  ];
}

function isSafeComposeServiceName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

export async function materializeEnvBundle(
  deployPath: string,
  values: Record<string, string>,
  componentValues: Record<string, Record<string, string>>,
  vps?: VpsConnection | null,
  options: { pruneManagedFiles?: boolean; environmentSlug?: string } = {}
) {
  const conn = vps || (await getActiveVps());
  const result = await execOnTarget(
    buildMaterializeEnvBundleCommand(deployPath, values, componentValues, options),
    conn
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to materialize environment");
  }
  return {
    hash: hashEnvBundle(values, componentValues),
    files: [
      ...(Object.keys(values).length > 0 || options.pruneManagedFiles ? [".env"] : []),
      ...Object.keys(componentValues)
        .filter(isSafeComposeServiceName)
        .filter((component) => Object.keys(componentValues[component]).length > 0)
        .map((component) => `${managedEnvRuntimeDirectory(deployPath, options.environmentSlug)}/${component}.env`),
      ...(Object.keys(componentValues).some((component) => Object.keys(componentValues[component]).length > 0)
        ? [MANAGED_ENV_FILES_MANIFEST, MANAGED_ENV_OVERRIDE_FILE]
        : []),
    ],
  };
}

export class MissingDeploymentEnvError extends Error {
  constructor(public readonly missing: string[]) {
    super("Missing required env keys for this redeploy");
    this.name = "MissingDeploymentEnvError";
  }
}

export async function applyEnvToDeployment(
  project: Project,
  deploymentId?: number,
  log?: (chunk: string) => void,
  options: {
    materialize?: boolean;
    components?: string[];
    environmentSlug?: string;
    vps?: VpsConnection | null;
  } = {}
) {
  const resolved = await resolveDeploymentEnv(project, options.environmentSlug);
  if (!resolved) return null;
  const scopedValidation = validateEnvForComponents(
    parseEnvJson(resolved.profile.schemaJson),
    resolved.values,
    resolved.componentValues,
    options.components
  );
  if (!scopedValidation.ok) {
    log?.(`[env] warning: missing required env keys: ${scopedValidation.missing.join(", ")}\n`);
    // Don't throw — missing keys are a warning, not a blocker.
    // Materialize still proceeds so the deployment gets whatever values exist.
  }
  if (options.materialize !== false && project.path) {
    const materialized = await materializeEnvBundle(
      project.path,
      resolved.values,
      resolved.componentValues,
      options.vps,
      { environmentSlug: resolved.profile.slug }
    );
    log?.(`[env] materialized ${resolved.profile.providerType} environment (${materialized.files.join(", ")})\n`);
  }
  await prisma.deploymentEnvProfile.update({
    where: { id: resolved.profile.id },
    data: {
      status: resolved.validation.ok ? "synced" : "missing",
      lastHash: resolved.validation.hash,
      lastSyncedAt: new Date(),
      lastError: resolved.validation.ok ? null : `Missing: ${resolved.validation.missing.join(", ")}`,
      deploymentId: deploymentId ?? resolved.profile.deploymentId,
    },
  });
  return resolved;
}

export function publicProfile(
  profile: DeploymentEnvProfile,
  values: Record<string, string>,
  schema: EnvSchemaEntry[],
  componentValues: Record<string, Record<string, string>> = {}
) {
  const validation = validateEnvBundle(schema, values, componentValues);
  return {
    ...profile,
    schema,
    validation,
    values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { masked: maskSecret(value), hasValue: !!value }])),
    componentValues: Object.fromEntries(
      Object.entries(componentValues).map(([component, scoped]) => [
        component,
        Object.fromEntries(Object.entries(scoped).map(([key, value]) => [
          key,
          { masked: maskSecret(value), hasValue: !!value },
        ])),
      ])
    ),
  };
}

export { encryptInfisicalCredentials };
