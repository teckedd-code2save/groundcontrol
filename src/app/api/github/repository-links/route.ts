import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import {
  linkGithubRepositoryToDeployment,
  useInferredGithubRepositoryIdentity,
} from "@/lib/github-app-service";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const deploymentId = Number(req.nextUrl.searchParams.get("deploymentId"));
    if (!Number.isSafeInteger(deploymentId) || deploymentId <= 0) {
      return NextResponse.json({ error: "deploymentId is required" }, { status: 400 });
    }
    const [links, repositories] = await Promise.all([
      prisma.githubRepositoryDeployment.findMany({
        where: { enrolledDeploymentId: deploymentId },
        include: {
          repository: {
            select: {
              id: true,
              fullName: true,
              htmlUrl: true,
              defaultBranch: true,
              isPrivate: true,
              installationId: true,
            },
          },
        },
      }),
      prisma.githubRepository.findMany({
        where: { isArchived: false, installation: { suspendedAt: null } },
        orderBy: { fullName: "asc" },
        select: {
          id: true,
          fullName: true,
          htmlUrl: true,
          defaultBranch: true,
          isPrivate: true,
          installationId: true,
        },
      }),
    ]);
    return NextResponse.json({
      current: links[0]
        ? { ...links[0].repository, source: links[0].source }
        : null,
      repositories,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") throw new HttpError("Admin access required", 403);
    const body = await req.json() as { deploymentId?: number; repositoryId?: string };
    const deploymentId = Number(body.deploymentId);
    const repositoryId = String(body.repositoryId || "").trim();
    if (!Number.isSafeInteger(deploymentId) || deploymentId <= 0 || !repositoryId) {
      return NextResponse.json({ error: "deploymentId and repositoryId are required" }, { status: 400 });
    }
    const result = await linkGithubRepositoryToDeployment({ deploymentId, repositoryId });
    return NextResponse.json({ ok: true, link: result });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") throw new HttpError("Admin access required", 403);
    const body = await req.json() as { deploymentId?: number };
    const deploymentId = Number(body.deploymentId);
    if (!Number.isSafeInteger(deploymentId) || deploymentId <= 0) {
      return NextResponse.json({ error: "deploymentId is required" }, { status: 400 });
    }
    const result = await useInferredGithubRepositoryIdentity(deploymentId);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return handleApiError(error);
  }
}
