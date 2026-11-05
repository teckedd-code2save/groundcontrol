import { createHash } from "node:crypto";

export interface StandaloneRecipe {
  version: 1;
  kind: "local-image";
  deploymentId: number;
  projectId: number;
  containerId: string;
  imageId: string;
  hostname: string;
  containerPort: number;
  hostPort: number;
  configHash: string;
}

export interface ContainerSnapshot {
  Id: string;
  Name: string;
  Image: string;
  Config: Record<string, unknown>;
  HostConfig: Record<string, unknown>;
  Mounts: unknown[];
  NetworkSettings: {
    Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null> | null;
    Networks?: Record<string, { Aliases?: unknown; Links?: unknown; IPAMConfig?: unknown }>;
  };
  State: { Running: boolean; Status: string; Paused?: boolean; Restarting?: boolean; Dead?: boolean; Health?: { Status: string } };
}

const idPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const ownerIdIsValid = (id: unknown): id is number => Number.isSafeInteger(id) && Number(id) > 0;
const portIsValid = (port: unknown): port is number => Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65535;
const empty = (value: unknown) => value == null || (Array.isArray(value) ? value.length === 0 : typeof value === "object" && Object.keys(value).length === 0);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Secret values stay in memory: only a fingerprint of Docker's complete config is persisted. */
export function standaloneConfigHash(snapshot: ContainerSnapshot, recipe: Pick<StandaloneRecipe, "containerPort" | "hostPort">) {
  if (!snapshot.Config || !snapshot.HostConfig || !imagePattern.test(snapshot.Image)) throw new Error("Incomplete container configuration evidence.");
  if (!Array.isArray(snapshot.Mounts) || snapshot.Mounts.length || !empty(snapshot.Config.Volumes) || !empty(snapshot.HostConfig.Binds) || !empty(snapshot.HostConfig.Mounts) || !empty(snapshot.HostConfig.VolumesFrom)) {
    throw new Error("Containers with filesystem mounts need an explicit storage-aware recreate recipe.");
  }
  if (snapshot.HostConfig.Privileged || snapshot.HostConfig.AutoRemove || !["default", "bridge"].includes(String(snapshot.HostConfig.NetworkMode))) throw new Error("This container is outside the local-image recreate contract.");
  const networks = snapshot.NetworkSettings?.Networks;
  const pendingNetwork = snapshot.State?.Status === "created" && empty(networks);
  if (!pendingNetwork && (!networks || Object.keys(networks).length !== 1 || !networks.bridge || !empty(networks.bridge.Aliases) || !empty(networks.bridge.Links) || !empty(networks.bridge.IPAMConfig))) throw new Error("Only the original default bridge network can be recreated.");
  const bindings = snapshot.HostConfig.PortBindings as Record<string, Array<{ HostIp: string; HostPort: string }>> | undefined;
  const key = `${recipe.containerPort}/tcp`;
  if (!bindings || Object.keys(bindings).length !== 1 || bindings[key]?.length !== 1 || bindings[key][0].HostIp !== "127.0.0.1") throw new Error("The recorded private port binding changed.");
  const bound = bindings[key][0].HostPort;
  const active = snapshot.NetworkSettings.Ports?.[key];
  if (bound !== String(recipe.hostPort)) throw new Error("A fixed private port binding is required for safe recreation and rollback.");
  if (active?.length && (active.length !== 1 || active[0].HostIp !== "127.0.0.1" || active[0].HostPort !== String(recipe.hostPort))) throw new Error("The active private port changed.");
  if (snapshot.State.Running && !active?.length) throw new Error("No assigned private port was observed.");
  const config = { ...snapshot.Config, Image: snapshot.Image };
  const host = { ...snapshot.HostConfig, PortBindings: { [key]: [{ HostIp: "127.0.0.1", HostPort: String(recipe.hostPort) }] } };
  return createHash("sha256").update(JSON.stringify(canonical({ config, host }))).digest("hex");
}

/** Called only immediately after GC's own fixed local-image launcher, never on an imported container. */
export function captureStandaloneRecipe(snapshot: ContainerSnapshot, input: { deploymentId: number; projectId: number; containerName: string; containerPort: number; hostPort: number }): StandaloneRecipe | null {
  try {
    const hostname = snapshot.Config?.Hostname;
    if (!ownerIdIsValid(input.deploymentId) || !ownerIdIsValid(input.projectId) || !idPattern.test(snapshot.Id) || !imagePattern.test(snapshot.Image) || snapshot.Name !== `/${input.containerName}` || typeof hostname !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(hostname) || !portIsValid(input.hostPort) || !portIsValid(input.containerPort)) return null;
    const labels = snapshot.Config.Labels as Record<string, unknown> | undefined;
    if (labels?.["io.groundcontrol.deployment"] !== String(input.deploymentId) || labels?.["io.groundcontrol.project"] !== String(input.projectId)) return null;
    return { version: 1, kind: "local-image", deploymentId: input.deploymentId, projectId: input.projectId, containerId: snapshot.Id, imageId: snapshot.Image, hostname, containerPort: input.containerPort, hostPort: input.hostPort, configHash: standaloneConfigHash(snapshot, input) };
  } catch { return null; }
}

export function parseStandaloneRecipe(deployment: { id?: number; projectGroupId?: number | null; metadataJson?: string | null }): StandaloneRecipe | null {
  try {
    const metadata = JSON.parse(deployment.metadataJson || "{}");
    const recipe = metadata.recreateRecipe as StandaloneRecipe;
    if (metadata.source !== "local-image" || !recipe || recipe.version !== 1 || recipe.kind !== "local-image" || !ownerIdIsValid(recipe.deploymentId) || !ownerIdIsValid(recipe.projectId) || recipe.deploymentId !== deployment.id || recipe.projectId !== deployment.projectGroupId || !idPattern.test(recipe.containerId) || !imagePattern.test(recipe.imageId) || !idPattern.test(recipe.configHash) || typeof recipe.hostname !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(recipe.hostname) || !portIsValid(recipe.containerPort) || !portIsValid(recipe.hostPort)) return null;
    return recipe;
  } catch { return null; }
}

export function assertStandaloneSnapshot(snapshot: ContainerSnapshot, recipe: StandaloneRecipe, name: string, id = recipe.containerId) {
  if (snapshot.Id !== id || snapshot.Name !== `/${name}` || snapshot.Image !== recipe.imageId || standaloneConfigHash(snapshot, recipe) !== recipe.configHash) throw new Error("The container identity or configuration changed since its recreate recipe was captured.");
}

export function standaloneRecipeIdentity(recipe: StandaloneRecipe | null) {
  if (!recipe) return null;
  const { containerId: _currentInstance, ...identity } = recipe;
  return identity;
}
