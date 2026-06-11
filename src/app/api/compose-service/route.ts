import { NextRequest, NextResponse } from "next/server";
import { resolveComposeProjectPath, runDockerCompose, shQuote } from "@/lib/vps";

export async function POST(req: NextRequest) {
  try {
    const { projectSlug, service } = await req.json();
    if (!projectSlug || !service) {
      return NextResponse.json(
        { error: "projectSlug and service required" },
        { status: 400 }
      );
    }

    const target = await resolveComposeProjectPath(projectSlug, service);
    const result = await runDockerCompose(
      target.projectPath,
      `up -d ${shQuote(target.service || service)}`
    );

    return NextResponse.json({
      success: result.code === 0,
      output: result.stdout,
      error: result.stderr || undefined,
      projectPath: target.projectPath,
      source: target.source,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
