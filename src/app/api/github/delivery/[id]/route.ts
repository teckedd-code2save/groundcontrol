import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { jsonObject } from "@/lib/agent-runtime-capabilities";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req);
    const { id } = await context.params;
    const build = await prisma.agentOperation.findFirst({ where: { id, grant: { userId: user.id, revokedAt: null } } });
    if (!build) throw new HttpError("Deployment workflow not found.", 404);
    const releaseId = jsonObject(build.resultJson).releaseOperationId;
    const release = typeof releaseId === "string" ? await prisma.agentOperation.findFirst({ where: { id: releaseId, grantId: build.grantId, deploymentId: build.deploymentId } }) : null;
    const state = release || build;
    const completed = Boolean(release?.status === "success");
    return NextResponse.json({ id: build.id, deploymentId: build.deploymentId, status: completed ? "success" : state.status === "success" ? "pending" : state.status, phase: release ? "release" : "build", error: state.error, completed });
  } catch (error) { return handleApiError(error); }
}
