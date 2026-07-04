import { decryptMaybe, encryptIfNeeded } from "./crypto";

export interface InfisicalProviderConfig {
  host?: string;
  projectId?: string;
  environment?: string;
  secretPath?: string;
}

export interface InfisicalCredentials {
  clientId?: string;
  clientSecret?: string;
}

export interface InfisicalSecret {
  key: string;
  value: string;
}

export function normalizeInfisicalHost(host?: string): string {
  const value = (host || "https://app.infisical.com").trim().replace(/\/+$/, "");
  return value.endsWith("/api") ? value.slice(0, -4) : value;
}

export function encryptInfisicalCredentials(credentials: InfisicalCredentials): string {
  return encryptIfNeeded(JSON.stringify(credentials)) as string;
}

export function decryptInfisicalCredentials(value?: string | null): InfisicalCredentials {
  if (!value) return {};
  try {
    return JSON.parse(decryptMaybe(value) || "{}") as InfisicalCredentials;
  } catch {
    return {};
  }
}

async function infisicalRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Infisical returned non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "message" in json
        ? String((json as { message?: unknown }).message)
        : `HTTP ${response.status}`;
    throw new Error(`Infisical API error: ${message}`);
  }
  return json as T;
}

export async function loginInfisicalUniversalAuth(
  config: InfisicalProviderConfig,
  credentials: InfisicalCredentials
): Promise<string> {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error("Infisical client ID and client secret are required");
  }
  const host = normalizeInfisicalHost(config.host);
  const result = await infisicalRequest<{ accessToken?: string; token?: string }>(
    `${host}/api/v1/auth/universal-auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      }),
    }
  );
  const token = result.accessToken || result.token;
  if (!token) throw new Error("Infisical login did not return an access token");
  return token;
}

function normalizeSecretList(value: unknown): InfisicalSecret[] {
  const root = value as Record<string, unknown>;
  const secrets = Array.isArray(root?.secrets)
    ? root.secrets
    : Array.isArray(root?.secret)
      ? root.secret
      : [];
  return secrets.flatMap((secret) => {
    if (!secret || typeof secret !== "object") return [];
    const item = secret as Record<string, unknown>;
    const key = item.secretKey || item.key || item.name;
    const secretValue = item.secretValue ?? item.value;
    if (typeof key !== "string") return [];
    return [{ key, value: secretValue == null ? "" : String(secretValue) }];
  });
}

export async function listInfisicalSecrets(
  config: InfisicalProviderConfig,
  credentials: InfisicalCredentials
): Promise<Record<string, string>> {
  const projectId = config.projectId?.trim();
  if (!projectId) throw new Error("Infisical project/workspace ID is required");
  const environment = config.environment || "prod";
  const secretPath = config.secretPath || "/";
  const token = await loginInfisicalUniversalAuth(config, credentials);
  const host = normalizeInfisicalHost(config.host);
  const params = new URLSearchParams({
    projectId,
    environment,
    secretPath,
    viewSecretValue: "true",
    expandSecretReferences: "true",
    recursive: "false",
  });
  const data = await infisicalRequest<unknown>(`${host}/api/v4/secrets?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return Object.fromEntries(normalizeSecretList(data).map((secret) => [secret.key, secret.value]));
}

export async function testInfisicalProvider(
  config: InfisicalProviderConfig,
  credentials: InfisicalCredentials
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const secrets = await listInfisicalSecrets(config, credentials);
    return { ok: true, count: Object.keys(secrets).length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Infisical test failed" };
  }
}
