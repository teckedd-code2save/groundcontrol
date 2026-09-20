import { decryptMaybe } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { createGithubInstallationToken } from "@/lib/github-app";
import { execOnTargetStrict } from "@/lib/host-exec";
import { shQuote, type VpsConnection } from "@/lib/vps";

export type GithubSourceSyncResult = {
  repository: string;
  branch: string;
  commitSha: string;
  tokenExpiresAt: string;
};

export function normalizeSourceBranch(value: unknown, fallback = "main"): string {
  const branch = String(value || fallback).trim();
  const invalid =
    !branch ||
    branch.length > 200 ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    branch.includes("\\") ||
    /[~^:?*\[\]\x00-\x20\x7f]/.test(branch) ||
    branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"));
  if (invalid) {
    throw new Error("The requested GitHub branch is not a safe branch name.");
  }
  return branch;
}

function redactCredential(value: string, credential: string): string {
  if (!value || !credential) return value;
  return value.split(credential).join("[REDACTED]");
}

async function sourceAccessForDeployment(deploymentId: number) {
  const links = await prisma.githubRepositoryDeployment.findMany({
    where: { enrolledDeploymentId: deploymentId },
    include: {
      repository: {
        include: {
          installation: {
            include: { connection: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const link = links.find((candidate) => candidate.source === "explicit") || links[0];
  if (!link) {
    throw new Error("No GitHub repository is linked to this deployment.");
  }

  const repository = link.repository;
  if (repository.isArchived) {
    throw new Error("The linked GitHub repository is archived.");
  }
  if (repository.installation.suspendedAt) {
    throw new Error("The GitHub App installation for this repository is suspended.");
  }

  const privateKey = decryptMaybe(repository.installation.connection.privateKeyEncrypted);
  if (!privateKey) {
    throw new Error("GroundControl cannot decrypt the GitHub App private key.");
  }
  const access = await createGithubInstallationToken({
    appId: repository.installation.connection.appId,
    privateKey,
    installationId: repository.installationId,
  });
  if (!["read", "write"].includes(access.permissions.contents || "")) {
    throw new Error("The GroundControl GitHub App does not have repository contents access.");
  }

  return {
    token: access.token,
    expiresAt: access.expiresAt,
    repository: {
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch || "main",
    },
  };
}

/**
 * Sync a linked GitHub repository onto an existing deployment tree without
 * persisting the short-lived installation token in the git remote or command.
 * The token is supplied over stdin to a temporary GIT_ASKPASS helper.
 */
export function buildGithubSourceSyncCommand(input: {
  projectPath: string;
  repository: string;
  branch: string;
}): string {
  const remote = `https://github.com/${input.repository}.git`;
  return [
    "set -eu",
    "umask 077",
    "IFS= read -r GC_GITHUB_TOKEN",
    "export GC_GITHUB_TOKEN",
    "export GIT_TERMINAL_PROMPT=0",
    "gc_askpass=$(mktemp /tmp/gc-git-askpass.XXXXXX)",
    "trap 'rm -f \"$gc_askpass\"' EXIT HUP INT TERM",
    "cat > \"$gc_askpass\" <<'GCASKPASS'",
    "#!/bin/sh",
    "case \"$1\" in",
    "  *Username*) printf '%s\\n' 'x-access-token' ;;",
    "  *) printf '%s\\n' \"$GC_GITHUB_TOKEN\" ;;",
    "esac",
    "GCASKPASS",
    "chmod 700 \"$gc_askpass\"",
    "export GIT_ASKPASS=\"$gc_askpass\"",
    `mkdir -p ${shQuote(input.projectPath)}`,
    `cd ${shQuote(input.projectPath)}`,
    "if [ ! -d .git ]; then git init; fi",
    `if git remote get-url origin >/dev/null 2>&1; then git remote set-url origin ${shQuote(remote)}; else git remote add origin ${shQuote(remote)}; fi`,
    `git fetch --depth 1 origin ${shQuote(input.branch)}`,
    `git checkout -B ${shQuote(input.branch)} --force FETCH_HEAD`,
    "git reset --hard FETCH_HEAD",
    "printf 'commit=%s\\n' \"$(git rev-parse HEAD)\"",
  ].join("\n");
}

export async function syncGithubDeploymentSource(input: {
  deploymentId: number;
  projectPath: string;
  branch?: unknown;
  vps?: VpsConnection | null;
}): Promise<GithubSourceSyncResult> {
  const access = await sourceAccessForDeployment(input.deploymentId);
  const branch = normalizeSourceBranch(input.branch, access.repository.defaultBranch);
  const command = buildGithubSourceSyncCommand({
    projectPath: input.projectPath,
    repository: access.repository.fullName,
    branch,
  });
  const result = await execOnTargetStrict(command, input.vps, undefined, `${access.token}\n`);
  if (result.code !== 0) {
    const detail = redactCredential(result.stderr || result.stdout || "git source sync failed", access.token)
      .trim()
      .slice(-1500);
    throw new Error(`GitHub source sync failed: ${detail}`);
  }
  const commitSha = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("commit="))
    ?.slice("commit=".length) || "";
  if (!/^[a-f0-9]{40,64}$/i.test(commitSha)) {
    throw new Error("GitHub source sync completed without a verifiable commit SHA.");
  }
  return {
    repository: access.repository.fullName,
    branch,
    commitSha,
    tokenExpiresAt: access.expiresAt,
  };
}
