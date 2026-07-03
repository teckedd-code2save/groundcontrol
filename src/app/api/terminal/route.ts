import { NextRequest, NextResponse } from "next/server";
import { getDockerComposeCommand, getKubeconfigEnv, resolveBinary, shQuote } from "@/lib/vps";
import { execOnTarget } from "@/lib/host-exec";
import { requireAuth } from "@/lib/auth";

const PATH_EXPORT = 'export PATH="/usr/local/bin:/usr/bin:/bin:/snap/bin:$PATH"';
const DEFAULT_ENV_EXPORT = `${PATH_EXPORT}; export ${getKubeconfigEnv()}`;

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
    let shHint: string | undefined;

    // sh-portability: the remote VPS shell is BusyBox/sh — `bash` is not
    // installed (`/bin/sh: bash: not found`). Rewrite a leading bash invocation
    // to its POSIX-sh equivalent so the command runs instead of failing.
    const bashMatch = cmd.match(/^\s*((?:\/usr)?\/bin\/)?bash\b([\s\S]*)$/);
    if (bashMatch) {
      const rest = (bashMatch[2] || "").trimStart();
      const dashC = rest.match(/^-c\b\s*([\s\S]*)$/);
      if (dashC) {
        cmd = `sh -c ${dashC[1]}`.trim();
        shHint = "Remote shell is sh (BusyBox); rewrote `bash -c` to `sh -c`.";
      } else if (rest) {
        cmd = `sh ${rest}`;
        shHint = "Remote shell is sh (BusyBox); rewrote `bash` to `sh`.";
      } else {
        // Bare interactive `bash` can't run here; treat as a no-op with a hint.
        return NextResponse.json({
          stdout: "",
          stderr: "Remote shell is sh (BusyBox) — `bash` is not installed. Drop the `bash` prefix and run commands directly.",
          code: 127,
        });
      }
    }

    const words = cmd.trim().split(/\s+/);
    const firstWord = words[0];
    const isDockerCompose = firstWord === "docker" && words[1] === "compose";

    if (isDockerCompose) {
      try {
        const composeCmd = await getDockerComposeCommand(null, execOnTarget);
        if (composeCmd !== "docker compose") {
          cmd = cmd.replace(/^\s*docker\s+compose\b/, composeCmd);
        }
      } catch {
        cmd = `${PATH_EXPORT} && ${cmd}`;
      }
    }

    // Auto-resolve common host/container binaries for non-interactive shells.
    if (["caddy", "nginx", "docker-compose"].includes(firstWord)) {
      try {
        const resolution = await resolveBinary(firstWord, null, execOnTarget);
        if (resolution.type === "docker" && (firstWord === "caddy" || firstWord === "nginx")) {
          cmd = cmd.replace(
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

    const result = await execOnTarget(`${DEFAULT_ENV_EXPORT}; ${cmd}`, null, cwd || "/");
    return NextResponse.json({
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      ...(shHint ? { hint: shHint } : {}),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
