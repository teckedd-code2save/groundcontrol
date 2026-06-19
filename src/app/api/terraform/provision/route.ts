import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { provisionInfraForDeploy } from "@/lib/deploy/pipeline";
import { handleApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const body = (await req.json()) as { projectId?: unknown; stackId?: unknown };
    const projectId = Number(body.projectId);
    const stackId = Number(body.stackId);

    if (!Number.isFinite(projectId)) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!Number.isFinite(stackId)) {
      return NextResponse.json({ error: "stackId is required" }, { status: 400 });
    }

    const result = await provisionInfraForDeploy({ projectId, stackId });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
