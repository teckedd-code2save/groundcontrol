import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  const url = new URL(req.url);
  const raw = url.searchParams.get("url") || "";

  if (!raw) {
    return NextResponse.json({ valid: false, error: "No URL provided" });
  }

  try {
    // Normalize: strip trailing .git, handle various formats
    let apiUrl = raw.replace(/\.git$/, "");
    if (apiUrl.includes("github.com")) {
      // Convert https://github.com/user/repo → https://api.github.com/repos/user/repo
      const path = apiUrl.split("github.com/")[1]?.replace(/\/$/, "");
      if (!path) throw new Error("Invalid GitHub URL");
      apiUrl = `https://api.github.com/repos/${path}`;
    } else {
      return NextResponse.json({ valid: false, error: "Not a GitHub URL" });
    }

    const res = await fetch(apiUrl, {
      headers: { "Accept": "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({
        valid: false,
        error: res.status === 404 ? "Repository not found" : `GitHub API error: ${res.status}`,
      });
    }

    const data = await res.json();
    return NextResponse.json({
      valid: true,
      name: data.full_name || data.name,
      private: data.private,
      defaultBranch: data.default_branch,
      description: data.description,
    });
  } catch (err) {
    return NextResponse.json({
      valid: false,
      error: err instanceof Error ? err.message : "Could not validate repository",
    });
  }
}
