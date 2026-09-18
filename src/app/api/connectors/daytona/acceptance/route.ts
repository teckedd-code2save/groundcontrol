import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import {
  listDaytonaAcceptanceDeployments,
  runDaytonaRepositoryAcceptance,
} from "@/lib/daytona-acceptance";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return NextResponse.json({
      deployments: await listDaytonaAcceptanceDeployments(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") throw new HttpError("Admin access required", 403);
    const body = await req.json() as {
      deploymentId?: number;
      validationCommand?: string;
    };
    const deploymentId = Number(body.deploymentId);
    if (!Number.isSafeInteger(deploymentId) || deploymentId <= 0) {
      return NextResponse.json({ error: "deploymentId is required" }, { status: 400 });
    }
    const result = await runDaytonaRepositoryAcceptance({
      deploymentId,
      validationCommand: body.validationCommand,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return handleApiError(error);
  }
}
