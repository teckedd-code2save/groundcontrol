import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runBuild } from "@/lib/deploy/pipeline";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const body = await req.json();
    const { projectSlug, branch } = body;

    if (!projectSlug || typeof projectSlug !== "string") {
      return NextResponse.json({ error: "projectSlug is required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const id = await runBuild({ projectId: project.id, branch });
    return NextResponse.json({ id, status: "building" });
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
