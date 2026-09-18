import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { decryptMaybe } from "@/lib/crypto";
import {
  createGithubInstallationToken,
  githubInstallationFetch,
  normalizeGithubRepositoryUrl,
} from "@/lib/github-app";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  requireAuth(req);

  const raw = req.nextUrl.searchParams.get("url") || "";
  const identity = normalizeGithubRepositoryUrl(raw);
  if (!identity) {
    return NextResponse.json({ valid: false, error: "Enter a valid GitHub repository URL." });
  }

  try {
    const installed = await prisma.githubRepository.findMany({
      include: {
        installation: { include: { connection: true } },
        deployments: {
          include: {
            deployment: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    const repository = installed.find((candidate) => candidate.fullName.toLowerCase() === identity);

    if (repository) {
      if (repository.installation.suspendedAt) {
        return NextResponse.json({
          valid: false,
          access: "github_app",
          error: "The GitHub App installation that owns this repository is suspended.",
        });
      }
      const privateKey = decryptMaybe(repository.installation.connection.privateKeyEncrypted);
      if (!privateKey) {
        return NextResponse.json({
          valid: false,
          access: "github_app",
          error: "GroundControl cannot decrypt the GitHub App private key.",
        });
      }
      const credential = await createGithubInstallationToken({
        appId: repository.installation.connection.appId,
        privateKey,
        installationId: repository.installation.id,
      });
      await githubInstallationFetch(
        credential.token,
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
      );
      return NextResponse.json({
        valid: true,
        access: "github_app",
        id: repository.id,
        name: repository.fullName,
        private: repository.isPrivate,
        defaultBranch: repository.defaultBranch,
        installationId: repository.installationId,
        tokenExpiresAt: credential.expiresAt,
        deployments: repository.deployments.map((link) => ({
          ...link.deployment,
          linkSource: link.source,
        })),
      });
    }

    const installationCount = await prisma.githubInstallation.count();
    if (installationCount > 0) {
      return NextResponse.json({
        valid: false,
        access: "github_app",
        error: "This repository is not granted to the installed GitHub App. Update repository access in GitHub, then sync GroundControl.",
      });
    }

    const [owner, name] = identity.split("/");
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "GroundControl",
        },
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      }
    );
    if (!response.ok) {
      return NextResponse.json({
        valid: false,
        access: "public_fallback",
        error: response.status === 404 ? "Repository not found or private. Connect the GitHub App for private access." : `GitHub API error: ${response.status}`,
      });
    }

    const data = await response.json() as {
      full_name?: string;
      name?: string;
      private?: boolean;
      default_branch?: string;
      description?: string | null;
    };
    return NextResponse.json({
      valid: true,
      access: "public_fallback",
      name: data.full_name || data.name,
      private: data.private,
      defaultBranch: data.default_branch,
      description: data.description,
    });
  } catch (error) {
    return NextResponse.json({
      valid: false,
      error: error instanceof Error ? error.message : "Could not validate repository",
    });
  }
}
