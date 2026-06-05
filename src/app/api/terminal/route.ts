import { NextRequest, NextResponse } from "next/server";
import { execOnVps, resolveBinary } from "@/lib/vps";
import { requireAuth } from "@/lib/auth";

const PATH_EXPORT = 'export PATH="/usr/local/bin:/usr/bin:/bin:/snap/bin:$PATH"';

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

    let cmd = command;
    const firstWord = command.trim().split(/\s+/)[0];

    // Auto-prefix PATH for known binaries that often live outside default non-interactive PATH
    if (["caddy", "nginx", "docker-compose"].includes(firstWord)) {
      try {
        const binPath = await resolveBinary(firstWord);
        if (binPath && !binPath.startsWith("docker exec")) {
          // If binary is in a non-standard path, prepend PATH export
          if (!binPath.startsWith("/usr/bin") && !binPath.startsWith("/bin")) {
            const dir = binPath.substring(0, binPath.lastIndexOf("/"));
            cmd = `export PATH="${dir}:$PATH" && ${cmd}`;
          }
        }
      } catch {
        // fallback to generic PATH export
        cmd = `${PATH_EXPORT} && ${cmd}`;
      }
    }

    const result = await execOnVps(cmd, null, cwd || "/");
    return NextResponse.json({
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
