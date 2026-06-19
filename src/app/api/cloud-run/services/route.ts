import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveCloudProviderAccount } from "@/lib/cloud/accounts";
import { getGcpAccessToken, listCloudRunServices } from "@/lib/cloud/gcp";
import { handleApiError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const region = searchParams.get("region");

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!region) {
      return NextResponse.json({ error: "region is required" }, { status: 400 });
    }

    const account = await getActiveCloudProviderAccount("gcp");
    if (!account) {
      return NextResponse.json(
        { error: "No active GCP account configured. Add one in Settings → Cloud Accounts." },
        { status: 400 }
      );
    }

    const accessToken = await getGcpAccessToken(account.credentialsObj);
    const services = await listCloudRunServices({ accessToken, projectId, region });

    return NextResponse.json({ services });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
