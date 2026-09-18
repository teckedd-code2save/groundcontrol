import { decryptMaybe, encrypt } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";
import { execOnTargetStrict } from "@/lib/host-exec";
import { prisma } from "@/lib/prisma";
import { getActiveVps, shQuote, type VpsConnection } from "@/lib/vps";

const PREFIX = "github_registry_";
const DOCKER_CONFIG = '"${HOME}/.groundcontrol/docker"';

export type RegistryStatus = "not_configured" | "ready" | "error";

export type RegistryState = {
  status: RegistryStatus;
  configured: boolean;
  username: string;
  verifiedImage: string;
  lastCheckedAt: string;
  error: string;
};

async function values() {
  const rows = await prisma.appConfig.findMany({
    where: { key: { startsWith: PREFIX } },
  });
  return Object.fromEntries(
    rows.map((row) => [row.key.slice(PREFIX.length), decryptMaybe(row.value) || ""])
  );
}

async function save(input: Record<string, string>) {
  await prisma.$transaction(
    Object.entries(input).map(([field, value]) =>
      prisma.appConfig.upsert({
        where: { key: `${PREFIX}${field}` },
        create: {
          key: `${PREFIX}${field}`,
          value: field === "token" ? encrypt(value) : value,
        },
        update: { value: field === "token" ? encrypt(value) : value },
      })
    )
  );
}

async function loginGithubRegistry(
  username: string,
  token: string,
  vps: VpsConnection
) {
  return execOnTargetStrict(
    `mkdir -p ${DOCKER_CONFIG} && chmod 700 ${DOCKER_CONFIG} && DOCKER_CONFIG=${DOCKER_CONFIG} docker login ghcr.io -u ${shQuote(username)} --password-stdin`,
    vps,
    undefined,
    `${token}\n`
  );
}

/**
 * Rehydrate the saved registry credential onto the execution plane that will
 * run Docker Compose. Tokens are passed through stdin and never shell args.
 */
export async function ensureGithubRegistryLogin(vps?: VpsConnection | null) {
  const config = await values();
  if (!config.username || !config.token) {
    return { configured: false };
  }

  const target = vps || (await getActiveVps());
  if (!target) {
    throw new HttpError("Connect a VPS before pulling private images.", 400);
  }

  const login = await loginGithubRegistry(config.username, config.token, target);
  if (login.code !== 0) {
    throw new HttpError(
      `GitHub package access failed: ${(login.stderr || login.stdout || "login failed").trim().slice(0, 240)}`,
      400
    );
  }
  return { configured: true };
}

function registryFailureKind(message: string) {
  const normalized = message.toLowerCase();
  if (/bad credentials|unauthorized|authentication required|denied|forbidden|invalid token/.test(normalized)) {
    return "revoked_or_invalid";
  }
  if (/scope|permission|package/.test(normalized)) return "missing_scope";
  return "unavailable";
}

export async function verifyGithubRegistryAccess(
  vps?: VpsConnection | null
): Promise<{
  ok: boolean;
  state: RegistryState;
  failureKind?: "not_configured" | "revoked_or_invalid" | "missing_scope" | "unavailable";
}> {
  const config = await values();
  if (!config.username || !config.token) {
    return {
      ok: false,
      state: await githubRegistryPublicState(),
      failureKind: "not_configured",
    };
  }

  const target = vps || (await getActiveVps().catch(() => null));
  if (!target) {
    const error = "Connect a VPS before verifying private image access.";
    await save({
      status: "error",
      last_checked_at: new Date().toISOString(),
      error,
    });
    return {
      ok: false,
      state: await githubRegistryPublicState(),
      failureKind: "unavailable",
    };
  }

  const login = await loginGithubRegistry(config.username, config.token, target);
  if (login.code !== 0) {
    const error = (login.stderr || login.stdout || "GitHub registry login failed").trim().slice(0, 240);
    await save({
      status: "error",
      verified_image: "",
      last_checked_at: new Date().toISOString(),
      error,
    });
    return {
      ok: false,
      state: await githubRegistryPublicState(),
      failureKind: registryFailureKind(error),
    };
  }

  const deployment = await prisma.deployment.findFirst({
    where: { imageTag: { startsWith: "ghcr.io/" } },
    orderBy: { createdAt: "desc" },
    select: { imageTag: true },
  });
  const image = deployment?.imageTag?.trim() || "";

  if (image) {
    const probe = await execOnTargetStrict(
      `DOCKER_CONFIG=${DOCKER_CONFIG} docker manifest inspect ${shQuote(image)} >/dev/null 2>&1`,
      target
    );
    if (probe.code !== 0) {
      const error = `GitHub authenticated, but package access could not read ${image}.`;
      await save({
        status: "error",
        verified_image: "",
        last_checked_at: new Date().toISOString(),
        error,
      });
      return {
        ok: false,
        state: await githubRegistryPublicState(),
        failureKind: "missing_scope",
      };
    }
  }

  await save({
    status: "ready",
    verified_image: image,
    last_checked_at: new Date().toISOString(),
    error: "",
  });
  return { ok: true, state: await githubRegistryPublicState() };
}

export async function githubRegistryPublicState(): Promise<RegistryState> {
  const config = await values();
  const configured = Boolean(config.token && config.username);
  return {
    status: configured
      ? (config.status === "error" ? "error" : "ready")
      : "not_configured",
    configured,
    username: configured ? config.username : "",
    verifiedImage: config.verified_image || "",
    lastCheckedAt: config.last_checked_at || "",
    error: config.error || "",
  };
}

export async function configureGithubRegistry(input: { username?: string; token?: string }) {
  const username = String(input.username || "").trim();
  const token = String(input.token || "").trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username)) {
    throw new HttpError("Enter the GitHub username that owns the package credential.", 400);
  }
  if (token.length < 20 || /\s/.test(token)) {
    throw new HttpError("Enter a valid GitHub package token.", 400);
  }

  const vps = await getActiveVps();
  if (!vps) throw new HttpError("Connect a VPS before enabling private image access.", 400);

  const login = await loginGithubRegistry(username, token, vps);
  if (login.code !== 0) {
    throw new HttpError(
      `GitHub rejected the package credential: ${(login.stderr || login.stdout || "login failed").trim().slice(0, 240)}`,
      400
    );
  }

  const deployment = await prisma.deployment.findFirst({
    where: { imageTag: { startsWith: "ghcr.io/" } },
    orderBy: { createdAt: "desc" },
    select: { imageTag: true },
  });
  const image = deployment?.imageTag?.trim() || "";
  let status: "ready" | "error" = "ready";
  let error = "";

  if (image) {
    const probe = await execOnTargetStrict(
      `DOCKER_CONFIG=${DOCKER_CONFIG} docker manifest inspect ${shQuote(image)} >/dev/null 2>&1`,
      vps
    );
    if (probe.code !== 0) {
      status = "error";
      error = `The credential connected, but GitHub denied access to ${image}.`;
    }
  }

  await save({
    username,
    token,
    status,
    verified_image: status === "ready" ? image : "",
    last_checked_at: new Date().toISOString(),
    error,
  });

  return {
    ok: status === "ready",
    state: await githubRegistryPublicState(),
    message: image
      ? `Private image access verified for ${image}.`
      : "Private image access is ready and will be verified against the first GHCR deployment.",
  };
}

export async function disconnectGithubRegistry() {
  const vps = await getActiveVps().catch(() => null);
  if (vps) {
    await execOnTargetStrict(
      `DOCKER_CONFIG=${DOCKER_CONFIG} docker logout ghcr.io >/dev/null 2>&1 || true`,
      vps
    ).catch(() => undefined);
  }
  await prisma.appConfig.deleteMany({ where: { key: { startsWith: PREFIX } } });
}
