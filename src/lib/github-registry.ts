import { decryptMaybe, encrypt } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { execOnVps, getActiveVps, shQuote } from "@/lib/vps";

const PREFIX = "github_registry_";
const DOCKER_CONFIG = '"${HOME}/.groundcontrol/docker"';

type RegistryStatus = "not_configured" | "ready" | "error";

type RegistryState = {
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

  const login = await execOnVps(
    `mkdir -p ${DOCKER_CONFIG} && chmod 700 ${DOCKER_CONFIG} && DOCKER_CONFIG=${DOCKER_CONFIG} docker login ghcr.io -u ${shQuote(username)} --password-stdin`,
    vps,
    undefined,
    `${token}\n`
  );
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
    const probe = await execOnVps(
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
    await execOnVps(
      `DOCKER_CONFIG=${DOCKER_CONFIG} docker logout ghcr.io >/dev/null 2>&1 || true`,
      vps
    ).catch(() => undefined);
  }
  await prisma.appConfig.deleteMany({ where: { key: { startsWith: PREFIX } } });
}
