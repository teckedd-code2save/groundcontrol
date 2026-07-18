import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { githubAppPublicState } from "@/lib/github-app-service";
import { prisma } from "@/lib/prisma";

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
    return NextResponse.json({ ok: true, note: "Local credentials removed. Uninstall the App in GitHub to revoke it there." });
  } catch (error) {
    return handleApiError(error);
  }
}
