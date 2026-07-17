import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { auditLog, getClientInfo } from "@/lib/audit";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { resolveDeploymentEnv, serializeDotenv } from "@/lib/env-management";

const VALID_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Administrator access is required to export secrets" }, { status: 403 });
    }

    const { id } = await params;
    const component = new URL(req.url).searchParams.get("component")?.trim() || "";
    if (component && !VALID_COMPONENT.test(component)) {
      return NextResponse.json({ error: "Choose a valid deployment component" }, { status: 400 });
    }

    const profile = await prisma.deploymentEnvProfile.findUnique({
      where: { id: Number(id) },
      include: { project: true },
    });
    if (!profile) return NextResponse.json({ error: "Environment not found" }, { status: 404 });

    const resolved = await resolveDeploymentEnv(profile.project, profile.slug);
    if (!resolved) return NextResponse.json({ error: "Environment could not be resolved" }, { status: 404 });
    const values = component
      ? (resolved.componentValues[component] || {})
      : resolved.values;

    await auditLog({
      userId: user.id,
      action: "secret_export",
      context: getClientInfo(req),
      metadata: {
        projectId: profile.projectId,
        environmentId: profile.id,
        environment: profile.slug,
        component,
        keyCount: Object.keys(values).length,
      },
    });

    const filename = component ? `${component}.env` : ".env";
    return new NextResponse(serializeDotenv(values), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
