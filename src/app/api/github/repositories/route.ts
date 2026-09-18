import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

type PublicGithubRepository = {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  html_url?: unknown;
  clone_url?: unknown;
  default_branch?: unknown;
  description?: unknown;
  private?: unknown;
  archived?: unknown;
  updated_at?: unknown;
};

function validOwner(value: string) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value);
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const owner = req.nextUrl.searchParams.get("owner")?.trim() || "";

    const installationCount = await prisma.githubInstallation.count();
    if (installationCount > 0) {
      if (owner && !validOwner(owner)) {
        return NextResponse.json({ error: "Enter a valid GitHub username or organization." }, { status: 400 });
      }
      const repositories = await prisma.githubRepository.findMany({
        where: {
          isArchived: false,
          ...(owner ? { owner } : {}),
          installation: { suspendedAt: null },
        },
        orderBy: [{ updatedAt: "desc" }, { fullName: "asc" }],
        include: {
          installation: { select: { id: true, accountLogin: true } },
          deployments: {
            include: {
              deployment: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });

      return NextResponse.json({
        owner: owner || null,
        access: "github_app",
        repositories: repositories.map((repository) => ({
          id: repository.id,
          name: repository.name,
          fullName: repository.fullName,
          url: `https://github.com/${repository.fullName}`,
          htmlUrl: repository.htmlUrl,
          defaultBranch: repository.defaultBranch,
          private: repository.isPrivate,
          archived: repository.isArchived,
          installationId: repository.installationId,
          installationAccount: repository.installation.accountLogin,
          deployments: repository.deployments.map((link) => ({
            ...link.deployment,
            linkSource: link.source,
          })),
          updatedAt: repository.updatedAt,
        })),
      });
    }

    if (!owner || !validOwner(owner)) {
      return NextResponse.json({
        error: "Connect the GitHub App for private repositories, or provide a public GitHub owner.",
      }, { status: 400 });
    }

    const response = await fetch(
      `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated&type=owner`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "GroundControl",
        },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      }
    );
    if (!response.ok) {
      return NextResponse.json({
        error: response.status === 404 ? "GitHub account not found." : `GitHub returned ${response.status}.`,
      }, { status: response.status === 404 ? 404 : 502 });
    }

    const repositories = (await response.json() as PublicGithubRepository[])
      .filter((item) => item.private !== true && item.archived !== true)
      .map((item) => ({
        id: Number(item.id || 0),
        name: String(item.name || ""),
        fullName: String(item.full_name || item.name || ""),
        url: String(item.clone_url || item.html_url || ""),
        htmlUrl: String(item.html_url || ""),
        defaultBranch: String(item.default_branch || "main"),
        description: typeof item.description === "string" ? item.description : "",
        private: false,
        updatedAt: typeof item.updated_at === "string" ? item.updated_at : null,
      }))
      .filter((item) => item.name && item.url);

    return NextResponse.json({ owner, repositories, access: "public_fallback" });
  } catch (error) {
    return handleApiError(error);
  }
}
