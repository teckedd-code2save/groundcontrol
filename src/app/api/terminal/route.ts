import { NextRequest, NextResponse } from "next/server";
import { execOnVps } from "@/lib/vps";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { command, cwd } = await req.json();
    if (!command || typeof command !== "string") {
      return NextResponse.json({ error: "Command required" }, { status: 400 });
    }

    // Safety: block destructive commands
    const blocked = [
      "rm -rf /",
      "mkfs.",
      "dd if=",
      ":(){ :|:& };:",
      "> /dev/sda",
    ];
    if (blocked.some((b) => command.includes(b))) {
      return NextResponse.json({ error: "Command blocked for safety" }, { status: 403 });
    }

    const result = await execOnVps(command, null, cwd || "/");
    return NextResponse.json({
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
