import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { shQuote } from "./vps";

const defaultExecAsync = promisify(exec);

const DOCKER_SOCK = "/var/run/docker.sock";
const BRIDGE_IMAGE = "groundcontrol-host-bridge:latest";
const OS_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin";
const HOST_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;

export interface BridgeDeps {
  statSync: typeof fs.statSync;
  execAsync: (command: string, options?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }>;
  execWithInput?: (
    command: string,
    input: string,
    options?: { timeout?: number }
  ) => Promise<{ stdout: string; stderr: string }>;
}

function execWithInput(
  command: string,
  input: string,
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = exec(command, { timeout: options?.timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin?.end(input);
  });
}

const defaultDeps: BridgeDeps = {
  statSync: fs.statSync,
  execAsync: defaultExecAsync,
  execWithInput,
};

function withOsPath(command: string): string {
  return `export PATH="${OS_PATH}:$PATH"; ${command}`;
}

/** Detect whether the host Docker socket is mounted into this container. */
export function isDockerSocketAvailable(deps: BridgeDeps = defaultDeps): boolean {
  try {
    return deps.statSync(DOCKER_SOCK).isSocket();
  } catch {
    return false;
  }
}

/** True if the local Docker CLI can talk to the daemon through the socket. */
export async function canTalkToDockerDaemon(deps: BridgeDeps = defaultDeps): Promise<boolean> {
  if (!isDockerSocketAvailable(deps)) return false;
  try {
    const { stdout } = await deps.execAsync("docker version --format '{{.Server.Version}}'", {
      timeout: 10000,
    });
    return !!stdout.trim();
  } catch {
    return false;
  }
}

function bridgeDockerfile(): string {
  return `FROM alpine:3.19
RUN apk add --no-cache util-linux
ENTRYPOINT ["/usr/bin/nsenter"]
`;
}

/** Ensure the local bridge image exists; build it lazily from a tiny Dockerfile. */
export async function ensureBridgeImage(deps: BridgeDeps = defaultDeps): Promise<boolean> {
  try {
    const { stdout } = await deps.execAsync(`docker images -q ${BRIDGE_IMAGE}`, { timeout: 10000 });
    if (stdout.trim()) return true;
  } catch {
    // ignore
  }

  try {
    await deps.execAsync(`docker build -t ${BRIDGE_IMAGE} - <<'EOF'\n${bridgeDockerfile()}EOF`, {
      timeout: 120000,
    });
    const { stdout } = await deps.execAsync(`docker images -q ${BRIDGE_IMAGE}`, { timeout: 10000 });
    return !!stdout.trim();
  } catch (err) {
    console.error("[docker-host-bridge] Failed to build bridge image:", err);
    return false;
  }
}

/** True when the Docker-socket bridge is usable without privileged flags on GC itself. */
export async function canUseDockerHostBridge(deps: BridgeDeps = defaultDeps): Promise<boolean> {
  if (!(await canTalkToDockerDaemon(deps))) return false;
  return ensureBridgeImage(deps);
}

/**
 * Execute a command in the host OS namespaces by spawning a temporary privileged
 * container through the mounted Docker socket. This lets a containerized
 * GroundControl manage the host (install packages, edit configs, control
 * services) without requiring --pid=host on the GroundControl container itself.
 */
export async function execViaDockerHostBridge(
  command: string,
  opts?: { cwd?: string; stdin?: string },
  deps: BridgeDeps = defaultDeps
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (!(await ensureBridgeImage(deps))) {
    return {
      stdout: "",
      stderr: "Docker host bridge image is not available",
      code: 1,
    };
  }

  const cwdPrefix = opts?.cwd ? `cd ${shQuote(opts.cwd)} && ` : "";
  const wrapped = withOsPath(`${cwdPrefix}${command}`);

  // --pid=host lets nsenter see the host's PID 1. Privileged is required for
  // nsenter to enter the host mount/network namespaces. The helper container
  // is ephemeral and is removed automatically.
  const dockerCmd = [
    `docker run --rm${opts?.stdin !== undefined ? " -i" : ""}`,
    "--privileged",
    "--pid=host",
    BRIDGE_IMAGE,
    "-t 1 -m -u -i -n -p --",
    "sh -c",
    shQuote(wrapped),
  ].join(" ");

  try {
    const { stdout, stderr } = opts?.stdin !== undefined
      ? await (deps.execWithInput || execWithInput)(dockerCmd, opts.stdin, { timeout: HOST_COMMAND_TIMEOUT_MS })
      : await deps.execAsync(dockerCmd, { timeout: HOST_COMMAND_TIMEOUT_MS });
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
 * Start a host-namespace command in a detached helper container. Docker owns
 * the helper lifecycle, so it survives GroundControl replacing its own app
 * container during a self-redeploy.
 */
export async function execDetachedViaDockerHostBridge(
  command: string,
  outputFile: string,
  deps: BridgeDeps = defaultDeps
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (!(await ensureBridgeImage(deps))) {
    return { stdout: "", stderr: "Docker host bridge image is not available", code: 1 };
  }

  const wrapped = withOsPath(command);
  const redirected = `${wrapped} > ${shQuote(outputFile)} 2>&1`;
  const dockerCmd = [
    "docker run -d --rm",
    "--privileged",
    "--pid=host",
    BRIDGE_IMAGE,
    "-t 1 -m -u -i -n -p --",
    "sh -c",
    shQuote(redirected),
  ].join(" ");

  try {
    const { stdout, stderr } = await deps.execAsync(dockerCmd, { timeout: 30000 });
    return { stdout: stdout.trim(), stderr, code: 0 };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout || "",
      stderr: execError.stderr || "Could not start detached host command",
      code: execError.code || 1,
    };
  }
}
