import { NextRequest, NextResponse } from "next/server";
import { execOnVps } from "@/lib/vps";

export async function POST(req: NextRequest) {
  try {
    const { image, name, ports, env, command } = await req.json();
    if (!image) {
      return NextResponse.json({ error: "image required" }, { status: 400 });
    }

    const containerName = name || image.replace(/[^a-zA-Z0-9_-]/g, "-").substring(0, 40);
    
    let runCmd = `docker run -d --name ${containerName}`;
    
    if (ports && Array.isArray(ports)) {
      for (const p of ports) {
        runCmd += ` -p ${p}`;
      }
    }
    
    if (env && Array.isArray(env)) {
      for (const e of env) {
        runCmd += ` -e ${e}`;
      }
    }
    
    runCmd += ` ${image}`;
    
    if (command) {
      runCmd += ` ${command}`;
    }

    const result = await execOnVps(runCmd);
    
    if (result.code !== 0) {
      return NextResponse.json(
        { success: false, error: result.stderr || "Failed to start container" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      containerId: result.stdout.trim(),
      name: containerName,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
