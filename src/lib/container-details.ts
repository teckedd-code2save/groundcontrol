import { execOnVps, getActiveVps, shQuote } from "@/lib/vps";

export interface ContainerDetail {
  name: string;
  id: string;
  image: string;
  imageId: string;
  state: string;
  status: string;
  health: string;
  exitCode: number;
  oomKilled: boolean;
  pid: number;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
  restartCount: number;
  restartPolicy: string;
  command: string;
  ports: Array<{ container: string; host: string }>;
  networks: Array<{ name: string; ipAddress: string; gateway: string }>;
  mounts: Array<{ type: string; source: string; destination: string; readOnly: boolean }>;
  environmentKeys: string[];
  compose: {
    project: string;
    service: string;
    workingDir: string;
    configFiles: string;
  };
  stats: null | {
    cpu: string;
    memory: string;
    network: string;
    block: string;
    pids: string;
  };
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0);
}

export async function getContainerDetail(containerName: string): Promise<ContainerDetail> {
  const name = containerName.trim();
  if (!name) throw new Error("Container name is required.");

  const vps = await getActiveVps();
  const inspect = await execOnVps(`docker inspect ${shQuote(name)}`, vps);
  if (inspect.code !== 0 || !inspect.stdout.trim()) {
    throw new Error(inspect.stderr.trim() || `Container "${name}" was not found.`);
  }

  let item: JsonRecord;
  try {
    const parsed = JSON.parse(inspect.stdout) as unknown;
    item = record(Array.isArray(parsed) ? parsed[0] : null);
  } catch {
    throw new Error(`Docker returned invalid inspect data for "${name}".`);
  }

  const config = record(item.Config);
  const state = record(item.State);
  const health = record(state.Health);
  const hostConfig = record(item.HostConfig);
  const networkSettings = record(item.NetworkSettings);
  const labels = record(config.Labels);
  const networks = record(networkSettings.Networks);
  const ports = record(networkSettings.Ports);

  const statsResult = text(state.Status) === "running"
    ? await execOnVps(
        `docker stats --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}" ${shQuote(name)}`,
        vps
      )
    : null;
  const statsParts = statsResult?.stdout.trim().split("|") || [];

  const environmentKeys = Array.isArray(config.Env)
    ? config.Env
        .map((entry) => text(entry).split("=")[0].trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    : [];

  const portRows: ContainerDetail["ports"] = [];
  for (const [containerPort, mappings] of Object.entries(ports)) {
    if (!Array.isArray(mappings) || mappings.length === 0) {
      portRows.push({ container: containerPort, host: "internal only" });
      continue;
    }
    for (const mapping of mappings) {
      const value = record(mapping);
      const hostIp = text(value.HostIp);
      const hostPort = text(value.HostPort);
      portRows.push({
        container: containerPort,
        host: `${hostIp && hostIp !== "0.0.0.0" ? `${hostIp}:` : ""}${hostPort}`,
      });
    }
  }

  const networkRows = Object.entries(networks).map(([networkName, value]) => {
    const network = record(value);
    return {
      name: networkName,
      ipAddress: text(network.IPAddress),
      gateway: text(network.Gateway),
    };
  });

  const mountRows = Array.isArray(item.Mounts)
    ? item.Mounts.map((value) => {
        const mount = record(value);
        return {
          type: text(mount.Type),
          source: text(mount.Source),
          destination: text(mount.Destination),
          readOnly: mount.RW === false,
        };
      })
    : [];

  const path = text(config.Entrypoint)
    ? text(config.Entrypoint)
    : text(item.Path);
  const args = Array.isArray(item.Args) ? item.Args.map(text).filter(Boolean) : [];

  return {
    name: text(item.Name).replace(/^\//, "") || name,
    id: text(item.Id),
    image: text(config.Image),
    imageId: text(item.Image),
    state: text(state.Status),
    status: state.Running === true ? "running" : text(state.Status),
    health: text(health.Status),
    exitCode: number(state.ExitCode),
    oomKilled: state.OOMKilled === true,
    pid: number(state.Pid),
    createdAt: text(item.Created),
    startedAt: text(state.StartedAt),
    finishedAt: text(state.FinishedAt),
    restartCount: number(item.RestartCount),
    restartPolicy: text(record(hostConfig.RestartPolicy).Name) || "none",
    command: [path, ...args].filter(Boolean).join(" "),
    ports: portRows,
    networks: networkRows,
    mounts: mountRows,
    environmentKeys,
    compose: {
      project: text(labels["com.docker.compose.project"]),
      service: text(labels["com.docker.compose.service"]),
      workingDir: text(labels["com.docker.compose.project.working_dir"]),
      configFiles: text(labels["com.docker.compose.project.config_files"]),
    },
    stats: statsParts.length >= 5
      ? {
          cpu: statsParts[0],
          memory: statsParts[1],
          network: statsParts[2],
          block: statsParts[3],
          pids: statsParts[4],
        }
      : null,
  };
}
