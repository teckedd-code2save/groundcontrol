import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getActiveVps, shQuote, type VpsConnection } from "@/lib/vps";

export async function requireTerminalAdmin(req: NextRequest) {
  const user = requireAuth(req);
  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (current?.role !== "admin") throw new HttpError("Administrator access is required for the terminal", 403);
  return user;
}

export async function resolveTerminalTarget(id: unknown): Promise<VpsConnection> {
  if (!Number.isSafeInteger(id) || Number(id) <= 0) {
    throw new HttpError("A saved vpsId is required. Reload the terminal to select a target.", 400);
  }
  const vps = await prisma.vpsConfig.findUnique({ where: { id: Number(id) } });
  if (!vps) throw new HttpError("The terminal target no longer exists. Reload to select a target.", 409);
  return { id: vps.id, host: vps.host, port: vps.port, username: vps.username, isLocal: vps.isLocal };
}

export async function initialTerminalTarget() {
  const vps = await getActiveVps();
  if (!vps) throw new HttpError("No VPS configured", 409);
  return { vpsId: vps.id, host: vps.host, cwd: "/" };
}

/** The remote shell owns command parsing and directory resolution. */
export function wrapTerminalCommand(command: string, cwd: string) {
  const marker = "__gc_cwd_" + randomUUID() + "__";
  const script = "cd " + shQuote(cwd) + " || exit $?\n" + command +
    "\n_gc_terminal_exit=$?\nprintf '\\n" + marker + "%s\\n' \"$(pwd -P)\"\nexit \"$_gc_terminal_exit\"";
  return { command: script, marker };
}

export function parseTerminalOutput(stdout: string, marker: string) {
  const start = stdout.lastIndexOf("\n" + marker);
  if (start < 0) return { stdout };
  const path = stdout.slice(start + marker.length + 1).replace(/\n$/, "");
  if (!path.startsWith("/") || /[\r\n\0]/.test(path)) return { stdout };
  return { stdout: stdout.slice(0, start), cwd: path };
}
