import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import {
  configureGithubRegistry,
  disconnectGithubRegistry,
  githubRegistryPublicState,
} from "@/lib/github-registry";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return NextResponse.json(await githubRegistryPublicState());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") throw new HttpError("Admin access required", 403);
    const body = await req.json().catch(() => ({}));
    const result = await configureGithubRegistry({
      username: body.username,
      token: body.token,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") throw new HttpError("Admin access required", 403);
    await disconnectGithubRegistry();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
