import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { exchangeGithubManifestCode, verifyGithubManifestState } from "@/lib/github-app";
import { prisma } from "@/lib/prisma";

function settingsRedirect(req: NextRequest, params: Record<string, string>, publicUrl?: string) {
  const url = new URL("/settings", publicUrl || process.env.GC_PUBLIC_URL || req.nextUrl.origin);
  url.searchParams.set("tab", "connectors");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") return settingsRedirect(req, { github_error: "Admin access is required." });
    const code = req.nextUrl.searchParams.get("code") || "";
    const stateToken = req.nextUrl.searchParams.get("state") || "";
    if (!code || !stateToken) return settingsRedirect(req, { github_error: "GitHub did not return a complete setup response." });

    const state = verifyGithubManifestState(stateToken);
    if (state.userId !== user.id) return settingsRedirect(req, { github_error: "This GitHub setup belongs to another session." });
    const credentials = await exchangeGithubManifestCode(code);
    if (
      !credentials.id ||
      !credentials.slug ||
      !credentials.name ||
      !credentials.client_id ||
      !credentials.client_secret ||
      !credentials.pem ||
      !credentials.webhook_secret
    ) {
      throw new Error("GitHub returned an incomplete App credential bundle");
    }

    await prisma.$transaction(async (tx) => {
      await tx.githubWebhookDelivery.deleteMany({});
      await tx.githubAppConnection.deleteMany({});
      await tx.githubAppConnection.create({
        data: {
          appId: String(credentials.id),
          slug: credentials.slug,
          name: credentials.name,
          ownerLogin: credentials.owner?.login || "",
          clientId: credentials.client_id,
          clientSecretEncrypted: encrypt(credentials.client_secret),
          privateKeyEncrypted: encrypt(credentials.pem),
          webhookSecretEncrypted: encrypt(credentials.webhook_secret),
          publicUrl: state.publicUrl,
          permissionsJson: JSON.stringify(credentials.permissions || {}),
          eventsJson: JSON.stringify(credentials.events || []),
        },
      });
    });
    return settingsRedirect(req, { github: "app-created" }, state.publicUrl);
  } catch (error) {
    console.error("[github-app-callback]", error);
    return settingsRedirect(req, { github_error: "GitHub App creation could not be completed." });
  }
}
