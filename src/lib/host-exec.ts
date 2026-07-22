import { exec } from "child_process";
import { promisify } from "util";
import { NodeSSH } from "node-ssh";
import { isContainerized } from "./runtime";
import { prisma } from "./prisma";
import { decryptMaybe } from "./crypto";
import { execDetached, execOnVps, shQuote, type VpsConnection } from "./vps";
import {
  canUseDockerHostBridge,
  execDetachedViaDockerHostBridge,
  execViaDockerHostBridge,
} from "./docker-host-bridge";

export { isContainerized };

const execAsync = promisify(exec);

const OS_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin";

function withOsPath(command: string): string {
  return `export PATH="${OS_PATH}:$PATH"; ${command}`;
}

export interface ExecOnHostOptions {
  /** Optional VPS connection to use for SSH gateway strategy credentials. */
  vps?: VpsConnection | null;
  cwd?: string;
  stdin?: string;
  requireHost?: boolean;
}

interface SshCredentials {
  username: string;
  authType: string;
  privateKey?: string;
  password?: string;
}

let nsenterCache: boolean | null = null;
let bridgeCache: boolean | null = null;

/** Reset internal caches. Exported for tests only. */
export function __resetHostExecCache(): void {
  nsenterCache = null;
  bridgeCache = null;
}

async function isNsenterAvailable(): Promise<boolean> {
  if (nsenterCache !== null) return nsenterCache;

  // First try a cheap version check.
  try {
    const { stdout } = await execAsync("nsenter --version", { timeout: 5000 });
    if (stdout.toLowerCase().includes("nsenter")) {
      nsenterCache = true;
      return true;
    }
  } catch {
    // fall through to a functional test
  }

  // Functional test: try to enter PID 1 namespaces.
  try {
    const result = await execAsync("nsenter -t 1 -- echo ok", { timeout: 5000 });
    nsenterCache = result.stdout.trim() === "ok";
    return nsenterCache;
  } catch {
    nsenterCache = false;
    return false;
  }
}

function isIp(value: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return false;
  return value.split(".").every((octet) => {
    const n = parseInt(octet, 10);
    return n >= 0 && n <= 255;
  });
}

async function resolveHostGateway(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      "getent hosts host.docker.internal 2>/dev/null || true",
      { timeout: 5000 }
    );
    const ip = stdout.trim().split(/\s+/)[0];
    if (isIp(ip)) return ip;
  } catch {
    // ignore
  }

  try {
    const { stdout } = await execAsync(
      "ip route | awk '/default/ {print $3}' | head -1",
      { timeout: 5000 }
    );
    const ip = stdout.trim();
    if (isIp(ip)) return ip;
  } catch {
    // ignore
  }

  // Docker's default bridge gateway on Linux.
  return "172.17.0.1";
}

async function getActiveVpsCredentials(
  override?: VpsConnection | null
): Promise<SshCredentials | null> {
  if (override) {
    if (override.isLocal) return null;
    return {
      username: override.username,
      authType: override.authType || "key",
      privateKey: override.privateKey,
      password: override.password,
    };
  }

  const active = await prisma.vpsConfig.findFirst({
    where: { isActive: true },
  });
  const config =
    active ||
    (await prisma.vpsConfig.findFirst({
      orderBy: { updatedAt: "desc" },
    }));

  if (!config || config.isLocal) return null;

  return {
    username: config.username,
    authType: config.authType || "key",
    privateKey: (decryptMaybe(config.privateKey) as string | undefined) || undefined,
    password: (decryptMaybe(config.password) as string | undefined) || undefined,
  };
}

async function execSsh(
  host: string,
  port: number,
  creds: SshCredentials,
  command: string,
  cwd?: string,
  stdin?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const ssh = new NodeSSH();
  const sshConfig: Record<string, unknown> = {
    host,
    port,
    username: creds.username,
    readyTimeout: 20000,
  };

  if (creds.authType === "key" && creds.privateKey) {
    sshConfig.privateKey = creds.privateKey;
  } else if (creds.password) {
    sshConfig.password = creds.password;
  } else if (creds.privateKey) {
    sshConfig.privateKey = creds.privateKey;
  } else {
    throw new Error("No SSH credential available for host gateway");
  }

  await ssh.connect(sshConfig);
  const result = await ssh.execCommand(withOsPath(command), {
    cwd: cwd || "/root",
    ...(stdin !== undefined ? { stdin } : {}),
  });
  await ssh.dispose();
  return { stdout: result.stdout, stderr: result.stderr, code: result.code || 0 };
}

async function execInContainer(
  command: string,
  cwd?: string,
  stdin?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (stdin !== undefined) {
    return new Promise((resolve) => {
      const child = exec(
        withOsPath(command),
        { timeout: 30000, cwd },
        (error: (Error & { code?: number; stdout?: string; stderr?: string }) | null, stdout, stderr) => {
          resolve({
            stdout: stdout || error?.stdout || "",
            stderr: stderr || error?.stderr || "",
            code: error?.code || 0,
          });
        }
      );
      child.stdin?.end(stdin);
    });
  }

  try {
    const { stdout, stderr } = await execAsync(withOsPath(command), {
      timeout: 30000,
      cwd,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execErr.stdout || "",
      stderr: execErr.stderr || "",
      code: execErr.code || 1,
    };
  }
}

/**
 * Execute a command on the host OS when GroundControl is running inside a
 * container. Falls back to executing inside the container if no host access
 * strategy is available.
 *
 * Returns the same shape as {@link execOnVps}.
 */
export async function execOnHost(
  command: string,
  opts: ExecOnHostOptions = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (!isContainerized()) {
    return execInContainer(command, opts.cwd, opts.stdin);
  }

  // Strategy 0: use the mounted Docker socket to spawn a temporary privileged
  // container that enters the host namespaces. This works even when the GC
  // container itself is not started with --pid=host.
  if (bridgeCache === null) {
    bridgeCache = await canUseDockerHostBridge();
  }
  if (bridgeCache) {
    try {
      return await execViaDockerHostBridge(command, {
        cwd: opts.cwd,
        stdin: opts.stdin,
      });
    } catch {
      // bridge unavailable or failed; fall through to other strategies
    }
  }

  // Strategy 1: enter the host namespaces via nsenter.
  if (await isNsenterAvailable()) {
    try {
      const cwdPrefix = opts.cwd ? `cd ${shQuote(opts.cwd)} && ` : "";
      const nsenterCmd = `nsenter -t 1 -m -u -i -n -p -- sh -c ${shQuote(
        withOsPath(`${cwdPrefix}${command}`)
      )}`;
      return await execInContainer(nsenterCmd, undefined, opts.stdin);
    } catch {
      // nsenter present but failed; try SSH gateway
    }
  }

  // Strategy 2: SSH to the host gateway using active VPS credentials.
  const gateway = await resolveHostGateway();
  const creds = await getActiveVpsCredentials(opts.vps);
  if (gateway && creds) {
    try {
      return await execSsh(gateway, 22, creds, command, opts.cwd, opts.stdin);
    } catch {
      // SSH failed; fall back to container execution
    }
  }

  // Strategy 3: run inside the container and warn.
  if (opts.requireHost) {
    return {
      stdout: "",
      stderr: "GroundControl cannot access the host execution plane",
      code: 1,
    };
  }
  console.warn(
    "[host-exec] No host namespace access available; executing inside container"
  );
  return execInContainer(command, opts.cwd, opts.stdin);
}

/**
 * Return true if a host-execution strategy is likely to work.
 * Returns false when GroundControl is not containerized.
 */
export async function canExecOnHost(): Promise<boolean> {
  if (!isContainerized()) return false;
  if (bridgeCache === null) {
    bridgeCache = await canUseDockerHostBridge();
  }
  if (bridgeCache) return true;
  if (await isNsenterAvailable()) return true;
  const gateway = await resolveHostGateway();
  const creds = await getActiveVpsCredentials();
  return !!gateway && !!creds;
}

/**
 * Execute a command on the intended target. If GroundControl is running inside
 * a container and the target is the local host, route the command to the host
 * OS via {@link execOnHost}. Otherwise delegate to {@link execOnVps} (local or
 * SSH). This is the function detection and bootstrap code should use.
 */
export async function execOnTarget(
  command: string,
  vps?: VpsConnection | null,
  cwd?: string,
  stdin?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const conn = vps ?? null;
  if (isContainerized() && (!conn || conn.isLocal)) {
    return execOnHost(command, { vps: conn, cwd, stdin });
  }
  return execOnVps(command, conn, cwd, stdin);
}

/**
 * Execute only on the intended deployment host. Unlike execOnTarget this never
 * falls back to the GroundControl app container when host access is missing.
 */
export async function execOnTargetStrict(
  command: string,
  vps?: VpsConnection | null,
  cwd?: string,
  stdin?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const conn = vps ?? null;
  if (isContainerized() && (!conn || conn.isLocal)) {
    return execOnHost(command, {
      vps: conn,
      cwd,
      stdin,
      requireHost: true,
    });
  }
  return execOnVps(command, conn, cwd, stdin);
}

/**
 * Start a detached command on the same execution plane used by execOnTarget.
 * A containerized local GroundControl must use the Docker host bridge so a
 * self-redeploy cannot terminate the process performing that redeploy.
 */
export async function execDetachedOnTarget(
  command: string,
  outputFile: string,
  vps?: VpsConnection | null
): Promise<{ stdout: string; stderr: string; code: number }> {
  const conn = vps ?? null;

  if (isContainerized() && (!conn || conn.isLocal)) {
    if (bridgeCache === null) {
      bridgeCache = await canUseDockerHostBridge();
    }
    if (!bridgeCache) {
      return {
        stdout: "",
        stderr: "Docker host bridge is required for a detached self-redeploy",
        code: 1,
      };
    }
    return execDetachedViaDockerHostBridge(command, outputFile);
  }

  if (!conn || conn.isLocal) {
    execDetached(command, outputFile);
    return { stdout: "", stderr: "", code: 0 };
  }

  return execOnVps(
    `nohup sh -c ${shQuote(command)} > ${shQuote(outputFile)} 2>&1 &`,
    conn
  );
}
