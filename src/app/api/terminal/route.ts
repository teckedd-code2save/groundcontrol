import { NextRequest, NextResponse } from "next/server";
import { getDockerComposeCommand, getKubeconfigEnv, resolveBinary, shQuote } from "@/lib/vps";
import { execOnTargetStrict } from "@/lib/host-exec";
import { handleApiError, HttpError } from "@/lib/errors";
import { initialTerminalTarget, parseTerminalOutput, requireTerminalAdmin, resolveTerminalTarget, wrapTerminalCommand } from "@/lib/terminal-execution";

const PATH_EXPORT = 'export PATH="/usr/local/bin:/usr/bin:/bin:/snap/bin:$PATH"';
const DEFAULT_ENV_EXPORT = PATH_EXPORT + "; export " + getKubeconfigEnv();

export async function GET(req: NextRequest) {
  try {
    await requireTerminalAdmin(req);
    return NextResponse.json(await initialTerminalTarget());
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    await requireTerminalAdmin(req);
    const body = await req.json().catch(() => { throw new HttpError("Invalid JSON body", 400); });
    const { command, cwd = "/", vpsId } = body ?? {};
    if (typeof command !== "string" || !command.trim() || command.length > 131072 || command.includes("\0")) {
      throw new HttpError("A nonempty command of at most 128 KiB is required", 400);
    }
    if (typeof cwd !== "string" || !cwd.startsWith("/") || /[\r\n\0]/.test(cwd)) {
      throw new HttpError("cwd must be an absolute directory path", 400);
    }
    const vps = await resolveTerminalTarget(vpsId);
    // Operator convenience check; the current administrator role is the access boundary.
    const blocked = ["rm -rf /", "mkfs.", "dd if=", ":(){ :|:& };:", "> /dev/sda"];
    if (blocked.some((value) => command.includes(value))) throw new HttpError("Command blocked for safety", 403);

    let cmd = command;
    const words = cmd.trim().split(/\s+/);
    const firstWord = words[0];
    if (firstWord === "docker" && words[1] === "compose") {
      try {
        const composeCmd = await getDockerComposeCommand(vps, execOnTargetStrict);
        if (composeCmd !== "docker compose") cmd = cmd.replace(/^\s*docker\s+compose\b/, composeCmd);
      } catch { /* Preserve the command and let its actual error be reported. */ }
    }
    if (["caddy", "nginx", "docker-compose"].includes(firstWord)) {
      try {
        const resolution = await resolveBinary(firstWord, vps, execOnTargetStrict);
        if (resolution.type === "docker" && (firstWord === "caddy" || firstWord === "nginx")) {
          cmd = cmd.replace(new RegExp("^\\s*" + firstWord + "\\b"), "docker exec " + shQuote(resolution.container) + " " + firstWord);
        } else if (resolution.type === "path") {
          cmd = cmd.replace(new RegExp("^\\s*" + firstWord + "\\b"), shQuote(resolution.path));
        }
      } catch { /* Keep the original command. */ }
    }
    const wrapped = wrapTerminalCommand(DEFAULT_ENV_EXPORT + "; " + cmd, cwd);
    const result = await execOnTargetStrict(wrapped.command, vps, "/");
    return NextResponse.json({ ...result, ...parseTerminalOutput(result.stdout, wrapped.marker), vpsId: vps.id });
  } catch (err) { return handleApiError(err); }
}
