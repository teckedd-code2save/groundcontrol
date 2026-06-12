import { encryptIfNeeded, decryptMaybe } from "./crypto";
import { prisma } from "./prisma";

export interface CloudflareAccountInput {
  name?: string;
  apiToken: string;
  accountId?: string;
  email?: string;
  isActive?: boolean;
}

export interface CloudflareAccountRecord {
  id: number;
  name: string;
  apiToken: string;
  accountId: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CfResult<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: string[];
  result: T;
}

const CF_BASE = "https://api.cloudflare.com/client/v4";

export function encryptCloudflareToken(token: string): string {
  return encryptIfNeeded(token) as string;
}

export function decryptCloudflareToken(token: string | null | undefined): string | null | undefined {
  return decryptMaybe(token);
}

export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "•".repeat(token.length);
  return "•".repeat(token.length - 4) + token.slice(-4);
}

export async function getActiveCloudflareAccount(): Promise<CloudflareAccountRecord | null> {
  const account = await prisma.cloudflareAccount.findFirst({
    where: { isActive: true },
  });
  if (!account) return null;
  return {
    ...account,
    apiToken: decryptCloudflareToken(account.apiToken) || "",
  };
}

export async function cfRequest<T>(
  path: string,
  opts: RequestInit = {},
  account?: CloudflareAccountRecord | null
): Promise<T> {
  const active = account || (await getActiveCloudflareAccount());
  if (!active) {
    throw new Error("No active Cloudflare account configured");
  }
  if (!active.apiToken) {
    throw new Error("Cloudflare account has no API token");
  }

  const url = `${CF_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${active.apiToken}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });

  let data: CfResult<T> | undefined;
  try {
    data = (await res.json()) as CfResult<T>;
  } catch {
    throw new Error(`Cloudflare API returned non-JSON (HTTP ${res.status})`);
  }

  if (!res.ok || !data.success) {
    const msg = data?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API error: ${msg}`);
  }

  return data.result;
}

export async function listTunnels(account?: CloudflareAccountRecord | null) {
  const active = account || (await getActiveCloudflareAccount());
  if (!active) throw new Error("No active Cloudflare account");
  if (!active.accountId) throw new Error("Cloudflare account ID is required to list tunnels");
  return cfRequest<Array<Record<string, unknown>>>(
    `/accounts/${active.accountId}/cfd_tunnel`,
    { method: "GET" },
    active
  );
}

export async function createTunnel(
  name: string,
  account?: CloudflareAccountRecord | null
): Promise<{ tunnel: Record<string, unknown>; token: string }> {
  const active = account || (await getActiveCloudflareAccount());
  if (!active) throw new Error("No active Cloudflare account");
  if (!active.accountId) throw new Error("Cloudflare account ID is required");
  const result = await cfRequest<Record<string, unknown> & { token?: string }>(
    `/accounts/${active.accountId}/cfd_tunnel`,
    {
      method: "POST",
      body: JSON.stringify({ name, config_src: "cloudflare" }),
    },
    active
  );
  const token = result.token || "";
  return { tunnel: result, token };
}

export async function deleteTunnel(
  tunnelId: string,
  account?: CloudflareAccountRecord | null
) {
  const active = account || (await getActiveCloudflareAccount());
  if (!active) throw new Error("No active Cloudflare account");
  if (!active.accountId) throw new Error("Cloudflare account ID is required");
  return cfRequest<Record<string, unknown>>(
    `/accounts/${active.accountId}/cfd_tunnel/${tunnelId}`,
    { method: "DELETE" },
    active
  );
}

export async function listZones(account?: CloudflareAccountRecord | null) {
  return cfRequest<Array<Record<string, unknown>>>("/zones", { method: "GET" }, account);
}

export interface DnsRecordData {
  type: "A" | "CNAME" | string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
}

export async function listDnsRecords(zoneId: string, account?: CloudflareAccountRecord | null) {
  return cfRequest<Array<Record<string, unknown>>>(
    `/zones/${zoneId}/dns_records`,
    { method: "GET" },
    account
  );
}

export async function updateDnsRecord(
  zoneId: string,
  recordId: string,
  data: DnsRecordData,
  account?: CloudflareAccountRecord | null
) {
  return cfRequest<Record<string, unknown>>(
    `/zones/${zoneId}/dns_records/${recordId}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
    account
  );
}

export async function createDnsRecord(
  zoneId: string,
  data: DnsRecordData,
  account?: CloudflareAccountRecord | null
) {
  return cfRequest<Record<string, unknown>>(
    `/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    account
  );
}

export async function verifyToken(account?: CloudflareAccountRecord | null) {
  return cfRequest<Record<string, unknown>>("/user/tokens/verify", { method: "GET" }, account);
}

export async function verifyCloudflareToken(account?: { apiToken: string }) {
  if (!account?.apiToken) throw new Error("No Cloudflare API token provided");
  return verifyToken({ apiToken: account.apiToken, id: 0, name: "", accountId: null, email: null, isActive: true, createdAt: new Date(), updatedAt: new Date() });
}


