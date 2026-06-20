import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { requireAuth } from "@/lib/auth";
import { isContainerized } from "@/lib/runtime";

const execAsync = promisify(exec);

async function resolveGatewayIp(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      "getent ahostsv4 host.docker.internal 2>/dev/null | awk '{print $1; exit}'",
      { timeout: 5000 }
    );
    const ip = stdout.trim();
    if (ip) return ip;
  } catch {
    // fall through
  }

  try {
    const { stdout } = await execAsync(
      "ip route 2>/dev/null | awk '/default/ {print $3}'",
      { timeout: 5000 }
    );
    const ip = stdout.trim();
    if (ip) return ip;
  } catch {
    // fall through
  }

  return "172.17.0.1";
}

async function isSshPortOpen(ip: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `timeout 2 bash -c 'exec 3<>/dev/tcp/${ip}/22' 2>/dev/null && echo open || echo closed`,
      { timeout: 5000 }
    );
    return stdout.trim() === "open";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const containerized = isContainerized();
    const gatewayIp = containerized ? await resolveGatewayIp() : null;
    const sshPortOpen = gatewayIp ? await isSshPortOpen(gatewayIp) : false;

    return NextResponse.json({
      containerized,
      gatewayIp,
      sshPortOpen,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
