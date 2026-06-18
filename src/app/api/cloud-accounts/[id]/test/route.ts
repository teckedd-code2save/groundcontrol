import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptCloudCredentials } from "@/lib/cloud/accounts";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

async function validateGcpCredentials(credentials: Record<string, unknown>): Promise<{
  success: boolean;
  message: string;
}> {
  const accessToken = credentials.access_token;
  if (typeof accessToken === "string" && accessToken.length > 0) {
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
        { method: "GET" }
      );
      if (res.ok) {
        const info = (await res.json()) as Record<string, unknown>;
        return {
          success: true,
          message: `Token valid (client_id: ${info.client_id || "unknown"}, expiry: ${info.expires_in || "unknown"})`,
        };
      }
      const text = await res.text();
      return { success: false, message: `Google tokeninfo rejected token: ${text}` };
    } catch (err: unknown) {
      return { success: false, message: `Tokeninfo request failed: ${getErrorMessage(err)}` };
    }
  }

  // Service account JSON structural validation.
  const hasClientEmail = typeof credentials.client_email === "string" && credentials.client_email.length > 0;
  const hasPrivateKey = typeof credentials.private_key === "string" && credentials.private_key.length > 0;
  if (hasClientEmail && hasPrivateKey) {
    return {
      success: true,
      message: `Service account JSON looks valid for ${credentials.client_email}. Token exchange is performed at deploy time.`,
    };
  }

  return {
    success: false,
    message: "GCP credentials must include either an access_token or service account JSON with client_email and private_key.",
  };
}

function validateAwsCredentials(credentials: Record<string, unknown>): {
  success: boolean;
  message: string;
} {
  const hasAccessKeyId = typeof credentials.accessKeyId === "string" && credentials.accessKeyId.length > 0;
  const hasSecretAccessKey =
    typeof credentials.secretAccessKey === "string" && credentials.secretAccessKey.length > 0;
  if (hasAccessKeyId && hasSecretAccessKey) {
    return { success: true, message: "AWS credentials look structurally valid." };
  }
  return {
    success: false,
    message: "AWS credentials must include accessKeyId and secretAccessKey.",
  };
}

function validateAzureCredentials(credentials: Record<string, unknown>): {
  success: boolean;
  message: string;
} {
  const hasTenantId = typeof credentials.tenantId === "string" && credentials.tenantId.length > 0;
  const hasClientId = typeof credentials.clientId === "string" && credentials.clientId.length > 0;
  const hasClientSecret =
    typeof credentials.clientSecret === "string" && credentials.clientSecret.length > 0;
  const hasSubscriptionId =
    typeof credentials.subscriptionId === "string" && credentials.subscriptionId.length > 0;
  if (hasTenantId && hasClientId && hasClientSecret && hasSubscriptionId) {
    return { success: true, message: "Azure credentials look structurally valid." };
  }
  return {
    success: false,
    message: "Azure credentials must include tenantId, clientId, clientSecret, and subscriptionId.",
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(req);

    const { id } = await params;
    const accountId = parseInt(id, 10);
    if (!Number.isFinite(accountId)) {
      return NextResponse.json({ error: "Invalid account id" }, { status: 400 });
    }

    const account = await prisma.cloudProviderAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const credentials = decryptCloudCredentials(account.credentials);

    let result: { success: boolean; message: string };
    switch (account.provider.toLowerCase()) {
      case "gcp":
        result = await validateGcpCredentials(credentials);
        break;
      case "aws":
        result = validateAwsCredentials(credentials);
        break;
      case "azure":
        result = validateAzureCredentials(credentials);
        break;
      default:
        result = { success: false, message: `Unknown provider: ${account.provider}` };
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
