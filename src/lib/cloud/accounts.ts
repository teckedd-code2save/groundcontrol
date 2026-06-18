import { encryptIfNeeded, decryptMaybe } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export interface CloudProviderAccountRecord {
  id: number;
  name: string;
  provider: string;
  credentials: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function encryptCloudCredentials(credentials: Record<string, unknown>): string {
  return encryptIfNeeded(JSON.stringify(credentials)) as string;
}

export function decryptCloudCredentials(encrypted: string): Record<string, unknown> {
  const decrypted = decryptMaybe(encrypted);
  if (!decrypted) return {};
  try {
    return JSON.parse(decrypted) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getActiveCloudProviderAccount(
  provider: string
): Promise<(CloudProviderAccountRecord & { credentialsObj: Record<string, unknown> }) | null> {
  const account = await prisma.cloudProviderAccount.findFirst({
    where: { provider: provider.toLowerCase(), isActive: true },
  });
  if (!account) return null;
  return {
    ...account,
    credentialsObj: decryptCloudCredentials(account.credentials),
  };
}

export function maskCredential(credential: string): string {
  if (!credential) return "";
  if (credential.length <= 8) return "•".repeat(credential.length);
  return "•".repeat(credential.length - 4) + credential.slice(-4);
}

export function serializeCloudProviderAccount(account: CloudProviderAccountRecord) {
  const credentialsObj = decryptCloudCredentials(account.credentials);
  return {
    id: account.id,
    name: account.name,
    provider: account.provider,
    isActive: account.isActive,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    credentials: maskSensitiveValues(credentialsObj),
  };
}

function maskSensitiveValues(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    "private_key",
    "client_secret",
    "access_token",
    "refresh_token",
    "secret",
    "password",
    "token",
    "api_key",
    "apiKey",
    "key",
  ];
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
      masked[key] = maskCredential(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      masked[key] = maskSensitiveValues(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
