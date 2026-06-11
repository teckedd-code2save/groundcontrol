import {
  controlContainer,
  execOnVps,
  shQuote,
  getActiveVps,
  type VpsConnection,
} from "./vps";

export type ContainerAction = "start" | "stop" | "restart" | "remove";

export interface ContainerState {
  name: string;
  /** Container id (short), empty when the container no longer exists. */
  id: string;
  /** Docker state, e.g. "running", "exited", "created". Empty when removed. */
  state: string;
  /** Human-readable status line, e.g. "Up 3 seconds". */
  status: string;
  /** True when the container no longer exists (e.g. after `remove`). */
  removed: boolean;
}

export interface ContainerActionResult {
  success: boolean;
  action: ContainerAction;
  name: string;
  /** stdout from the docker action command. */
  output: string;
  /** stderr from the docker action command (the useful error message). */
  error: string;
  /** Freshly-read state of the container after the action ran. */
  container: ContainerState | null;
}

/**
 * Read the current state of a single container directly from the VPS.
 *
 * Uses a targeted `docker ps -a --filter` (POSIX-sh portable, no bashisms)
 * so we never re-fetch the full list just to learn one container's state.
 * Returns `removed: true` when the container is gone.
 */
export async function readContainerState(
  containerName: string,
  vps?: VpsConnection | null
): Promise<ContainerState> {
  const conn = vps || (await getActiveVps());
  // Exact-name match via filter; format mirrors getDockerContainers().
  const result = await execOnVps(
    `docker ps -a --no-trunc --filter ${shQuote(`name=^/${containerName}$`)} --format "{{.Names}}|{{.Status}}|{{.ID}}|{{.State}}"`,
    conn
  );

  const line = result.stdout
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${containerName}|`));

  if (!line) {
    return { name: containerName, id: "", state: "", status: "", removed: true };
  }

  const [name, status, id, state] = line.split("|");
  return {
    name: name || containerName,
    id: (id || "").slice(0, 12),
    state: state || "",
    status: status || "",
    removed: false,
  };
}

/**
 * Perform a container action via the existing `controlContainer` helper, then
 * read back the real, current state so the UI can reconcile (no guessing).
 *
 * `controlContainer` is imported read-only from vps.ts and is not modified.
 */
export async function controlContainerWithState(
  action: ContainerAction,
  containerName: string,
  vps?: VpsConnection | null
): Promise<ContainerActionResult> {
  const conn = vps || (await getActiveVps());

  const actionResult = await controlContainer(action, containerName, conn);

  // After a remove the container should be gone; for start/stop/restart we read
  // back the fresh state so the badge can flip to running/stopped accurately.
  let container: ContainerState | null = null;
  try {
    container = await readContainerState(containerName, conn);
  } catch {
    container = null;
  }

  // Treat the action as successful if docker reported success. For removes,
  // also accept the case where the container is simply gone.
  const success =
    actionResult.success ||
    (action === "remove" && container?.removed === true);

  return {
    success,
    action,
    name: containerName,
    output: actionResult.output || "",
    error: actionResult.error || "",
    container: action === "remove" && container?.removed ? null : container,
  };
}
