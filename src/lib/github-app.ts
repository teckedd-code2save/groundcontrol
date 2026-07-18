import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import { HttpError } from "@/lib/errors";

const GITHUB_API = "https://api.github.com";
const STATE_TTL_SECONDS = 10 * 60;

export type GithubManifestState = {
  type: "github_app_manifest";
  userId: number;
  publicUrl: string;
  nonce: string;
};

export type GithubAppCredentials = {
  id: number;
  slug: string;
  name: string;
  client_id: string;
  client_secret: string;
  pem: string;
  webhook_secret: string;
  owner?: { login?: string };
  permissions?: Record<string, string>;
  events?: string[];
};

export type GithubRepositoryPayload = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  html_url: string;
  default_branch: string;
  owner: { login: string };
  permissions?: Record<string, boolean>;
};

function stateSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return secret;
}

export function normalizeGithubPublicUrl(value: string): string {
  const raw = value.trim().replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError("Enter the public URL used to reach this GroundControl instance.", 400);
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new HttpError("GitHub webhooks require a public HTTPS GroundControl URL.", 400);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new HttpError("The GroundControl public URL cannot contain credentials, a query, or a fragment.", 400);
  }
  return url.toString().replace(/\/$/, "");
}

export function createGithubManifestState(input: Omit<GithubManifestState, "type" | "nonce">): string {
  return jwt.sign(
    { ...input, type: "github_app_manifest", nonce: randomBytes(18).toString("hex") },
    stateSecret(),
    { expiresIn: STATE_TTL_SECONDS }
  );
}

export function verifyGithubManifestState(token: string): GithubManifestState {
  const value = jwt.verify(token, stateSecret()) as GithubManifestState;
  if (value.type !== "github_app_manifest" || !value.userId || !value.publicUrl || !value.nonce) {
    throw new HttpError("The GitHub App setup session is invalid.", 400);
  }
  return value;
}

export function buildGithubAppManifest(publicUrl: string, suffix = randomBytes(3).toString("hex")) {
  const base = normalizeGithubPublicUrl(publicUrl);
  const host = new URL(base).hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 30);
  return {
    name: `GroundControl ${host || "instance"} ${suffix}`,
    url: base,
    redirect_url: `${base}/api/github/app/callback`,
    hook_attributes: {
      url: `${base}/api/github/webhooks`,
      active: true,
    },
    public: false,
    default_permissions: {
      metadata: "read",
      contents: "read",
      actions: "read",
      checks: "write",
      statuses: "write",
      pull_requests: "write",
      deployments: "write",
    },
    default_events: [
      "push",
      "pull_request",
      "check_run",
      "check_suite",
      "workflow_run",
      "deployment",
      "deployment_status",
    ],
  };
}

async function githubFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GroundControl",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const requestId = response.headers.get("x-github-request-id");
    throw new HttpError(
      `GitHub API request failed (${response.status})${requestId ? ` · ${requestId}` : ""}.`,
      response.status >= 500 ? 502 : 400
    );
  }
  return response.json() as Promise<T>;
}

export function exchangeGithubManifestCode(code: string): Promise<GithubAppCredentials> {
  return githubFetch<GithubAppCredentials>(`/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
  });
}

export function createGithubAppJwt(appId: string, privateKey: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  return jwt.sign(
    { iat: nowSeconds - 60 },
    privateKey,
    { algorithm: "RS256", issuer: appId, expiresIn: "9m" }
  );
}

export async function createGithubInstallationToken(input: {
  appId: string;
  privateKey: string;
  installationId: string;
}): Promise<{ token: string; expiresAt: string }> {
  const appJwt = createGithubAppJwt(input.appId, input.privateKey);
  const value = await githubFetch<{ token: string; expires_at: string }>(
    `/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
    { method: "POST", headers: { Authorization: `Bearer ${appJwt}` } }
  );
  return { token: value.token, expiresAt: value.expires_at };
}

export async function listGithubInstallationRepositories(token: string): Promise<GithubRepositoryPayload[]> {
  const repositories: GithubRepositoryPayload[] = [];
  let page = 1;
  while (page <= 20) {
    const value = await githubFetch<{ repositories: GithubRepositoryPayload[] }>(
      `/installation/repositories?per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    repositories.push(...value.repositories);
    if (value.repositories.length < 100) break;
    page += 1;
  }
  return repositories;
}

export function verifyGithubWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=") || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function normalizeGithubRepositoryUrl(value: string | null | undefined): string {
  const raw = String(value || "").trim().replace(/\.git$/i, "");
  const ssh = raw.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
  const normalized = ssh ? `https://github.com/${ssh[1]}` : raw;
  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== "github.com") return "";
    const [owner, repository] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repository) return "";
    return `${owner}/${repository}`.toLowerCase();
  } catch {
    return "";
  }
}
