import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { syncGithubInstallation } from "@/lib/github-app-service";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") throw new HttpError("Admin access required", 403);
    const body = await req.json().catch(() => ({}));
    const installations = body.installationId
      ? [{ id: String(body.installationId) }]
      : await prisma.githubInstallation.findMany({ select: { id: true } });
    if (installations.length === 0) throw new HttpError("Install the GitHub App on at least one account first.", 400);
    const results = [];
    for (const installation of installations) {
      results.push({ installationId: installation.id, ...(await syncGithubInstallation(installation.id)) });
    }
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return handleApiError(error);
  }
}
