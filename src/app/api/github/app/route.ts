import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { githubAppPublicState } from "@/lib/github-app-service";
import { prisma } from "@/lib/prisma";
import { disconnectGithubRegistry } from "@/lib/github-registry";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return NextResponse.json(await githubAppPublicState());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") throw new HttpError("Admin access required", 403);
    await prisma.$transaction([
      prisma.githubWebhookDelivery.deleteMany({}),
      prisma.githubAppConnection.deleteMany({}),
    ]);
    await disconnectGithubRegistry();
    return NextResponse.json({ ok: true, note: "GitHub App and private image credentials removed locally. Uninstall the App in GitHub to revoke it there." });
  } catch (error) {
    return handleApiError(error);
  }
}
