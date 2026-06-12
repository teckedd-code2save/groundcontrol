import { NextRequest, NextResponse } from "next/server";
import { resolveComposeProjectPath, runDockerComposeDown } from "@/lib/vps";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const { projectSlug, services } = await req.json();
    if (!projectSlug) {
      return NextResponse.json({ error: "projectSlug required" }, { status: 400 });
    }

    const target = await resolveComposeProjectPath(projectSlug);
    const result = await runDockerComposeDown(
      target.projectPath,
      Array.isArray(services) ? services : undefined
    );

    return NextResponse.json({
      success: result.code === 0,
      output: result.stdout,
      error: result.stderr || undefined,
      projectPath: target.projectPath,
    });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
