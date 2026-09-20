import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const MCP_PROTOCOL_VERSION = "2026-07-28";

export const OAUTH_SCOPES = [
  "deployment:read",
  "deployment:logs",
  "deployment:health",
  "deployment:redeploy",
  "operation:read",
  "offline_access",
] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const OAUTH_SCOPE_LABELS: Record<OAuthScope, string> = {
  "deployment:read": "Inspect deployments and their recorded configuration",
  "deployment:logs": "Read deployment execution evidence and logs",
  "deployment:health": "Check runtime and public endpoint health",
  "deployment:redeploy": "Redeploy an approved workload",
  "operation:read": "Read durable operation progress and evidence",
  offline_access: "Stay connected using rotating refresh tokens",
};

const DEFAULT_SCOPE = "deployment:read deployment:health operation:read offline_access";
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export function requestOrigin(req: NextRequest): string {
  const forwardedProto = (req.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim();
  const forwardedHost = (req.headers.get("x-forwarded-host") || "").split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host");
  const protocol = forwardedProto || req.nextUrl.protocol.replace(":", "") || "https";
  if (host) return `${protocol}://${host}`.replace(/\/$/, "");
  return req.nextUrl.origin.replace(/\/$/, "");
}

export function mcpResource(origin: string) {
  return `${origin.replace(/\/$/, "")}/mcp`;
}

export function protectedResourceMetadataUrl(origin: string) {
  return `${origin.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
}

export function hashOpaqueToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function generateOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  return verifier.length >= 43 && verifier.length <= 128 && pkceChallenge(verifier) === challenge;
}

export function normalizeScope(value: unknown): string {
  const requested = String(value || DEFAULT_SCOPE)
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return Array.from(new Set(requested)).sort().join(" ");
}

export function scopeSet(value: string): Set<string> {
  return new Set(normalizeScope(value).split(" ").filter(Boolean));
}

export function hasScope(scope: string, required: OAuthScope): boolean {
  return scopeSet(scope).has(required);
}

export function validateScope(scope: string, userRole: string): string {
  const normalized = normalizeScope(scope);
  const unknown = [...scopeSet(normalized)].filter((item) => !OAUTH_SCOPES.includes(item as OAuthScope));
  if (unknown.length) throw new OAuthRequestError(`Unsupported scope: ${unknown.join(", ")}`, "invalid_scope");
  if (hasScope(normalized, "deployment:redeploy") && userRole !== "admin") {
    throw new OAuthRequestError("Administrator approval is required for deployment:redeploy", "invalid_scope");
  }
  return normalized;
}

export function parseResourceIds(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)));
  } catch {
    return [];
  }
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(normalized);
}

async function assertPublicHttpsUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new OAuthRequestError("Client metadata must use a credential-free HTTPS URL", "invalid_client");
  }
  if (url.hostname === "localhost" || isPrivateAddress(url.hostname)) {
    throw new OAuthRequestError("Client metadata must be publicly reachable", "invalid_client");
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new OAuthRequestError("Client metadata resolved to a private address", "invalid_client");
  }
  return url;
}

export function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function refreshClientMatches(input: {
  expectedClientId: string;
  tokenEndpointAuthMethod: string;
  presentedClientId?: string | null;
}) {
  const presented = String(input.presentedClientId || "").trim();

  // Public OAuth clients using token_endpoint_auth_method=none cannot
  // authenticate themselves at refresh time. The refresh token is already
  // bound to its grant/client in GroundControl, so client_id is optional.
  // If a client_id is presented, it must still match exactly.
  if (!presented) return input.tokenEndpointAuthMethod === "none";
  return presented === input.expectedClientId;
}

export function parseRedirectUris(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function resolveOAuthClient(clientId: string) {
  const existing = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (existing) return existing;

  if (!clientId.startsWith("https://")) {
    throw new OAuthRequestError("Unknown OAuth client", "invalid_client");
  }

  const metadataUrl = await assertPublicHttpsUrl(clientId);
  const response = await fetch(metadataUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new OAuthRequestError("Could not resolve client metadata", "invalid_client");
  const body = await response.text();
  if (body.length > 64_000) throw new OAuthRequestError("Client metadata is too large", "invalid_client");
  const metadata = JSON.parse(body) as {
    client_name?: string;
    redirect_uris?: string[];
    token_endpoint_auth_method?: string;
  };
  const redirectUris = Array.isArray(metadata.redirect_uris)
    ? metadata.redirect_uris.filter((uri) => typeof uri === "string" && isAllowedRedirectUri(uri))
    : [];
  if (!redirectUris.length) throw new OAuthRequestError("Client metadata has no usable redirect URI", "invalid_client");

  return prisma.oAuthClient.create({
    data: {
      clientId,
      clientName: String(metadata.client_name || metadataUrl.hostname).slice(0, 160),
      redirectUris: JSON.stringify(redirectUris),
      source: "cimd",
      tokenEndpointAuthMethod: "none",
    },
  });
}

export type AuthorizationRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: string;
};

export function readAuthorizationRequest(input: URLSearchParams | Record<string, unknown>): AuthorizationRequest {
  const get = (name: string) =>
    input instanceof URLSearchParams ? input.get(name) || "" : String(input[name] || "");
  return {
    responseType: get("response_type"),
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    scope: normalizeScope(get("scope")),
    state: get("state"),
    resource: get("resource"),
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method"),
  };
}

export async function validateAuthorizationRequest(
  request: AuthorizationRequest,
  origin: string,
  userRole: string
) {
  if (request.responseType !== "code") {
    throw new OAuthRequestError("Only authorization code flow is supported", "unsupported_response_type");
  }
  if (!request.clientId || !request.redirectUri) {
    throw new OAuthRequestError("client_id and redirect_uri are required", "invalid_request");
  }
  if (!request.codeChallenge || request.codeChallengeMethod !== "S256") {
    throw new OAuthRequestError("PKCE with S256 is required", "invalid_request");
  }
  if (request.resource && request.resource.replace(/\/$/, "") !== mcpResource(origin)) {
    throw new OAuthRequestError("The requested OAuth resource does not match this GroundControl MCP endpoint", "invalid_target");
  }
  const client = await resolveOAuthClient(request.clientId);
  if (!parseRedirectUris(client.redirectUris).includes(request.redirectUri)) {
    throw new OAuthRequestError("redirect_uri is not registered for this client", "invalid_request");
  }
  return {
    client,
    scope: validateScope(request.scope, userRole),
    resource: mcpResource(origin),
  };
}

export async function createAuthorizationCode(input: {
  grantId: number;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}) {
  const raw = generateOpaqueToken("gc_code");
  await prisma.oAuthAuthorizationCode.create({
    data: {
      grantId: input.grantId,
      codeHash: hashOpaqueToken(raw),
      redirectUri: input.redirectUri,
      scope: input.scope,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return raw;
}

export async function issueTokenPair(input: {
  grantId: number;
  scope: string;
  familyId?: string;
}) {
  const familyId = input.familyId || randomBytes(18).toString("base64url");
  const accessToken = generateOpaqueToken("gc_at");
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  await prisma.oAuthToken.create({
    data: {
      grantId: input.grantId,
      tokenHash: hashOpaqueToken(accessToken),
      kind: "access",
      familyId,
      scope: input.scope,
      expiresAt: accessExpiresAt,
    },
  });

  let refreshToken: string | undefined;
  if (hasScope(input.scope, "offline_access")) {
    refreshToken = generateOpaqueToken("gc_rt");
    await prisma.oAuthToken.create({
      data: {
        grantId: input.grantId,
        tokenHash: hashOpaqueToken(refreshToken),
        kind: "refresh",
        familyId,
        scope: input.scope,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: input.scope,
    familyId,
  };
}

export async function authenticateAccessToken(req: NextRequest) {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new OAuthBearerError("Missing bearer token", 401);
  const token = await prisma.oAuthToken.findUnique({
    where: { tokenHash: hashOpaqueToken(match[1]) },
    include: {
      grant: {
        include: {
          user: { select: { id: true, username: true, role: true, forcePasswordChange: true } },
          client: true,
        },
      },
    },
  });
  if (
    !token ||
    token.kind !== "access" ||
    token.revokedAt ||
    token.expiresAt <= new Date() ||
    token.grant.revokedAt ||
    token.grant.user.forcePasswordChange
  ) {
    throw new OAuthBearerError("Bearer token is invalid or expired", 401);
  }
  return {
    token,
    grant: token.grant,
    user: token.grant.user,
    client: token.grant.client,
    scopes: scopeSet(token.scope),
    resources: parseResourceIds(token.grant.resources),
  };
}

export function requireTokenScope(
  context: Awaited<ReturnType<typeof authenticateAccessToken>>,
  required: OAuthScope
) {
  if (!context.scopes.has(required)) {
    throw new OAuthBearerError(`Missing required scope: ${required}`, 403, required);
  }
}

export class OAuthRequestError extends Error {
  constructor(message: string, public readonly error: string, public readonly status = 400) {
    super(message);
  }
}

export class OAuthBearerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requiredScope?: OAuthScope
  ) {
    super(message);
  }
}
