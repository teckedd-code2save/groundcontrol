import { NextRequest, NextResponse } from "next/server";
import { execOnVps, getDockerComposeCommand, resolveBinary, shQuote } from "@/lib/vps";
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
    const words = command.trim().split(/\s+/);
    const firstWord = words[0];
    const isDockerCompose = firstWord === "docker" && words[1] === "compose";

    if (isDockerCompose) {
      try {
        const composeCmd = await getDockerComposeCommand();
        if (composeCmd !== "docker compose") {
          cmd = command.replace(/^\s*docker\s+compose\b/, composeCmd);
        }
      } catch {
        cmd = `${PATH_EXPORT} && ${cmd}`;
      }
    }

    // Auto-resolve common host/container binaries for non-interactive shells.
    if (["caddy", "nginx", "docker-compose"].includes(firstWord)) {
      try {
        const resolution = await resolveBinary(firstWord);
        if (resolution.type === "docker" && (firstWord === "caddy" || firstWord === "nginx")) {
          cmd = command.replace(
            new RegExp(`^\\s*${firstWord}\\b`),
            `docker exec ${shQuote(resolution.container)} ${firstWord}`
          );
        } else if (resolution.type === "path") {
          const binPath = resolution.path;
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
