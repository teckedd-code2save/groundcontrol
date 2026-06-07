import { NextRequest, NextResponse } from "next/server";
import { execOnVps, getDockerComposeCommand, getSystemConfig } from "@/lib/vps";

export async function POST(req: NextRequest) {
  try {
    const { projectSlug, service } = await req.json();
    if (!projectSlug || !service) {
      return NextResponse.json(
        { error: "projectSlug and service required" },
        { status: 400 }
      );
    }

    const config = await getSystemConfig();
    const projectPath = `${config.projectRoot}/${projectSlug}`;

    let composeCmd = await getDockerComposeCommand();
    let result = await execOnVps(
      `cd ${projectPath} && ${composeCmd} up -d ${service}`
    );

    if (
      result.code !== 0 &&
      (result.stderr.includes("unknown command") || result.stderr.includes("not found"))
    ) {
      composeCmd = "docker-compose";
      result = await execOnVps(
        `cd ${projectPath} && ${composeCmd} up -d ${service}`
      );
    }

    return NextResponse.json({
      success: result.code === 0,
      output: result.stdout,
      error: result.stderr || undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
