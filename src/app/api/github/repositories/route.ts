import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";

type GithubRepository = {
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

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const owner = new URL(req.url).searchParams.get("owner")?.trim() || "";
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
      return NextResponse.json({ error: "Enter a valid GitHub username or organization." }, { status: 400 });
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

    const repositories = (await response.json() as GithubRepository[])
      .filter((repo) => repo.private !== true && repo.archived !== true)
      .map((repo) => ({
        id: Number(repo.id || 0),
        name: String(repo.name || ""),
        fullName: String(repo.full_name || repo.name || ""),
        url: String(repo.clone_url || repo.html_url || ""),
        htmlUrl: String(repo.html_url || ""),
        defaultBranch: String(repo.default_branch || "main"),
        description: typeof repo.description === "string" ? repo.description : "",
        updatedAt: typeof repo.updated_at === "string" ? repo.updated_at : null,
      }))
      .filter((repo) => repo.name && repo.url);

    return NextResponse.json({ owner, repositories, access: "public" });
  } catch (error) {
    return handleApiError(error);
  }
}
