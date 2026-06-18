import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { provisionInfraForDeploy } from "@/lib/deploy/pipeline";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

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
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
