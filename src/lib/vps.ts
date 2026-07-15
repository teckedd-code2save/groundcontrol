import { NodeSSH } from "node-ssh";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "./prisma";
import { decryptMaybe } from "./crypto";

const execAsync = promisify(exec);
const OS_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin";
export const DEFAULT_KUBECONFIG_PATH = "/etc/rancher/k3s/k3s.yaml";

interface SshConfig {
  host: string;
  port: number;
  username: string;
  readyTimeout?: number;
  privateKey?: string;
  password?: string;
}

export function shQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function withOsPath(command: string): string {
  return `export PATH="${OS_PATH}:$PATH"; ${command}`;
}

function cleanDockerTemplateValue(value?: string): string {
  const clean = (value || "").trim();
  return clean === "<no value>" ? "" : clean;
}

export interface VpsConnection {
  id: number;
  host: string;
  port: number;
  username: string;
  isLocal: boolean;
  /** Optional inline credentials for transient connections (e.g. onboarding detect). */
  privateKey?: string;
  password?: string;
  authType?: string;
}

const sshCache: Map<number, NodeSSH> = new Map();

export async function getActiveVps(): Promise<VpsConnection | null> {
  // Prefer the explicitly-activated VPS. Fall back to most-recently-updated
  // for back-compat with configs created before isActive existed.
  let config = await prisma.vpsConfig.findFirst({
    where: { isActive: true },
  });
  if (!config) {
    config = await prisma.vpsConfig.findFirst({
      orderBy: { updatedAt: "desc" },
    });
  }
  if (!config) return null;
  return {
    id: config.id,
    host: config.host,
    port: config.port,
    username: config.username,
    isLocal: config.isLocal,
  };
}

export function getKubeconfigEnv(vps?: VpsConnection | null): string {
  return `KUBECONFIG=${shQuote(DEFAULT_KUBECONFIG_PATH)}`;
}

export async function execOnVps(
  command: string,
  vps?: VpsConnection | null,
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const conn = vps || (await getActiveVps());
  if (!conn) {
    throw new Error("No VPS configured");
  }

  if (conn.isLocal) {
    try {
      const { stdout, stderr } = await execAsync(withOsPath(command), { timeout: 30000, cwd });
      return { stdout, stderr, code: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || "",
        code: err.code || 1,
      };
    }
  }

  // SSH mode
  const isTransient = conn.id <= 0;
  let ssh = isTransient ? undefined : sshCache.get(conn.id);
  if (!ssh) {
    ssh = new NodeSSH();

    let host = conn.host;
    let port = conn.port;
    let username = conn.username;
    let authType = conn.authType || "key";
    let privateKey = conn.privateKey;
    let password = conn.password;

    // For saved configs, load and decrypt stored credentials from the DB.
    if (!isTransient) {
      const config = await prisma.vpsConfig.findUnique({
        where: { id: conn.id },
      });
      if (!config) throw new Error("VPS config not found");
      host = config.host;
      port = config.port;
      username = config.username;
      authType = config.authType;
      privateKey = decryptMaybe(config.privateKey) || undefined;
      password = decryptMaybe(config.password) || undefined;
    }

    const sshConfig: SshConfig = {
      host,
      port,
      username,
      readyTimeout: 20000,
    };

    if (authType === "key" && privateKey) {
      sshConfig.privateKey = privateKey;
    } else if (password) {
      sshConfig.password = password;
    }

    await ssh.connect(sshConfig as never);
    if (!isTransient) {
      sshCache.set(conn.id, ssh);
    }
  }

  const result = await ssh.execCommand(withOsPath(command), { cwd: cwd || "/root" });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code || 0,
  };
}

export async function testConnection(config: {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  authType: string;
  isLocal: boolean;
}): Promise<{ success: boolean; message: string }> {
  if (config.isLocal) {
    try {
      await execAsync("hostname && whoami");
      return { success: true, message: "Local connection OK" };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  const ssh = new NodeSSH();
  try {
    const sshConfig: SshConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 10000,
    };
    if (config.authType === "key" && config.privateKey) {
      sshConfig.privateKey = config.privateKey;
    } else if (config.password) {
      sshConfig.password = config.password;
    }
    await ssh.connect(sshConfig as never);
    const result = await ssh.execCommand("hostname && whoami");
    await ssh.dispose();
    if (result.code === 0) {
      return { success: true, message: `Connected as ${result.stdout.trim()}` };
    }
    return { success: false, message: result.stderr };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export async function getSystemStats(vps?: VpsConnection | null) {
  const conn = vps || (await getActiveVps());

  const uptime = await execOnVps("cat /proc/uptime | awk '{print $1}'", conn);
  const load = await execOnVps("cat /proc/loadavg | awk '{print $1, $2, $3}'", conn);
  const mem = await execOnVps(
    "free -m | awk 'NR==2{printf \"%.2f %.2f %.2f\", $3,$2,$7}'",
    conn
  );
  const disk = await execOnVps(
    "df -h / | awk 'NR==2{print $3, $2, $4, $5}'",
    conn
  );
  const cpuCount = await execOnVps("nproc", conn);

  const [usedMem, totalMem, freeMem] = mem.stdout.trim().split(" ").map(parseFloat);
  const [usedDisk, totalDisk, availDisk, diskPercent] = disk.stdout.trim().split(" ");

  return {
    uptime: parseFloat(uptime.stdout.trim()),
    load: load.stdout.trim().split(" ").map(parseFloat),
    memory: {
      used: usedMem,
      total: totalMem,
      free: freeMem,
      percent: totalMem > 0 ? ((usedMem / totalMem) * 100).toFixed(1) : "0",
    },
    disk: {
      used: usedDisk,
      total: totalDisk,
      available: availDisk,
      percent: diskPercent?.replace("%", "") || "0",
    },
    cpuCount: parseInt(cpuCount.stdout.trim()) || 1,
  };
}

export interface DockerContainerLabelInfo {
  name: string;
  project: string;
  service: string;
  workingDir: string;
  configFiles: string;
  projectSlug: string;
  createdAt?: string;
  startedAt?: string;
  restartCount?: number;
}

export async function getDockerContainers(vps?: VpsConnection | null) {
  const conn = vps || (await getActiveVps());
  const result = await execOnVps(
    `docker ps -a --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.ID}}|{{.State}}"`,
    conn
  );
  if (!result.stdout.trim()) return [];

  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [name, image, status, ports, id, state] = line.split("|");
      return { name, image, status, ports, id, state };
    });
}

export async function getDockerStats(vps?: VpsConnection | null) {
  const conn = vps || (await getActiveVps());
  const result = await execOnVps(
    `docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}"`,
    conn
  );
  if (!result.stdout.trim()) return [];

  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [name, cpu, mem, net, block, pids] = line.split("|");
      return { name, cpu, mem, net, block, pids };
    });
}

export async function getDockerContainerLabels(vps?: VpsConnection | null): Promise<DockerContainerLabelInfo[]> {
  const conn = vps || (await getActiveVps());
  // Fetch container names first, then inspect each individually to avoid xargs -r portability issues
  const namesResult = await execOnVps(
    `docker ps -aq --format "{{.Names}}" 2>/dev/null || echo ""`,
    conn
  );
  const names = namesResult.stdout.trim().split("\n").filter(Boolean);
  if (names.length === 0) return [];

  const results: DockerContainerLabelInfo[] = [];
  for (const name of names) {
    try {
      const inspect = await execOnVps(
        `docker inspect --format "{{.Name}}	{{index .Config.Labels \\"com.docker.compose.project\\"}}	{{index .Config.Labels \\"com.docker.compose.service\\"}}	{{index .Config.Labels \\"com.docker.compose.project.working_dir\\"}}	{{index .Config.Labels \\"com.docker.compose.project.config_files\\"}}" ${shQuote(name)} 2>/dev/null || echo ""`,
        conn
      );
      const stateInspect = await execOnVps(
        `docker inspect --format "{{.Created}}\t{{.State.StartedAt}}\t{{.RestartCount}}" ${shQuote(name)} 2>/dev/null || echo ""`,
        conn
      );
      const [n, project, service, workingDir, configFiles] = inspect.stdout.trim().split("\t");
      const [createdAt, startedAt, restartCount] = stateInspect.stdout.trim().split("\t");
      const resolvedWorkingDir = cleanDockerTemplateValue(workingDir);
      const resolvedProject = cleanDockerTemplateValue(project);
      if (n) {
        results.push({
          name: n.replace(/^\//, ""),
          project: resolvedProject,
          service: cleanDockerTemplateValue(service),
          workingDir: resolvedWorkingDir,
          configFiles: cleanDockerTemplateValue(configFiles),
          projectSlug: resolvedWorkingDir.split("/").filter(Boolean).pop() || resolvedProject,
          createdAt: createdAt || "",
          startedAt: startedAt || "",
          restartCount: Number(restartCount || 0),
        });
      }
    } catch {
      // skip containers we can't inspect
    }
  }
  return results;
}

export async function getContainerLogs(
  containerName: string,
  tail: number = 100,
  vps?: VpsConnection | null
) {
  const conn = vps || (await getActiveVps());
  const result = await execOnVps(
    `docker logs --tail ${Math.max(1, Math.min(5000, Number(tail) || 100))} ${shQuote(containerName)} 2>&1`,
    conn
  );
  return result.stdout;
}

const DEFAULT_SYSTEM_CONFIG = {
  id: 0,
  projectRoot: "/opt",
  templateDeploymentRoot: "/srv/groundcontrol/deployments",
  caddySitesDir: "/etc/caddy/sites",
  caddyFile: "/etc/caddy/Caddyfile",
  nginxSitesDir: "/etc/nginx/sites-available",
  nginxLogPath: "/var/log/nginx/error.log",
  staticRoot: "/var/www",
  sshDefaultCwd: "/root",
  certDomain: "",
  composeCommand: null as string | null,
  updatedAt: new Date(),
};

// Cache keyed by the resolved VPS id (or "global" when no active VPS).
const systemConfigCache: Map<string, { value: any; time: number }> = new Map();

/**
 * Resolve the filesystem/path config for the *active* VPS.
 *
 * Resolution order:
 *   1. SystemConfig row linked to the active VPS (per-VPS layout).
 *   2. The legacy/global SystemConfig row (vpsConfigId = null) — adopted by
 *      linking it to the active VPS so existing single-VPS setups keep working.
 *   3. A freshly-created row linked to the active VPS (defaults).
 *   4. If there is no active VPS at all: the global row, else defaults.
 *
 * Signature is unchanged (no-arg, returns a SystemConfig-shaped object) so
 * existing read-only call sites keep working.
 */
export async function getSystemConfig() {
  let activeVpsId: number | null = null;
  try {
    const active = await getActiveVps();
    activeVpsId = active?.id ?? null;
  } catch {
    activeVpsId = null;
  }

  const cacheKey = activeVpsId === null ? "global" : String(activeVpsId);
  const cached = systemConfigCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 30000) {
    return cached.value;
  }

  try {
    let config: any = null;

    if (activeVpsId !== null) {
      // 1. Per-VPS config row.
      config = await prisma.systemConfig.findUnique({
        where: { vpsConfigId: activeVpsId },
      });

      // 2. Adopt the legacy/global row for this VPS if no per-VPS row exists.
      if (!config) {
        const globalRow = await prisma.systemConfig.findFirst({
          where: { vpsConfigId: null },
        });
        if (globalRow) {
          config = await prisma.systemConfig.update({
            where: { id: globalRow.id },
            data: { vpsConfigId: activeVpsId },
          });
        }
      }

      // 3. Create a defaults row linked to the active VPS.
      if (!config) {
        config = await prisma.systemConfig.create({
          data: { vpsConfigId: activeVpsId },
        });
      }
    } else {
      // 4. No active VPS — use the global row (or create one).
      config = await prisma.systemConfig.findFirst({ where: { vpsConfigId: null } });
      if (!config) {
        config = await prisma.systemConfig.findFirst();
      }
      if (!config) {
        config = await prisma.systemConfig.create({ data: {} });
      }
    }

    systemConfigCache.set(cacheKey, { value: config, time: Date.now() });
    return config;
  } catch (err: any) {
    // Table may not exist (migration not run). Return defaults so the app doesn't crash.
    console.warn("SystemConfig table missing, using defaults:", err.message);
    return DEFAULT_SYSTEM_CONFIG;
  }
}

export function invalidateSystemConfigCache() {
  systemConfigCache.clear();
}

export async function getDockerComposeCommand(
  vps?: VpsConnection | null,
  execFn: (command: string, vps?: VpsConnection | null, cwd?: string) => Promise<{ stdout: string; stderr: string; code: number }> = execOnVps
): Promise<string> {
  const config = await getSystemConfig();
  if (config.composeCommand) {
    return config.composeCommand;
  }

  const conn = vps || (await getActiveVps());
  // Try docker compose (plugin) first, fallback to docker-compose (standalone)
  const pluginCheck = await execFn("docker compose version 2>/dev/null", conn);
  if (pluginCheck.code === 0 && pluginCheck.stdout.toLowerCase().includes("compose")) {
    return "docker compose";
  }
  const standaloneCheck = await execFn("docker-compose version 2>/dev/null", conn);
  if (standaloneCheck.code === 0 && standaloneCheck.stdout.toLowerCase().includes("compose")) {
    return "docker-compose";
  }
  // Also check if docker-compose binary exists on common paths even if `version` fails
  const whichDc = await execFn(`which docker-compose 2>/dev/null || command -v docker-compose 2>/dev/null || echo ""`, conn);
  if (whichDc.stdout.trim()) {
    return "docker-compose";
  }
  // Default to plugin syntax; caller should retry with fallback if this fails
  return "docker compose";
}

export async function runDockerCompose(
  projectPath: string,
  args: string,
  vps?: VpsConnection | null
) {
  const conn = vps || (await getActiveVps());
  const config = await getSystemConfig();
  const configured = config.composeCommand?.trim();
  const candidates = configured
    ? [configured]
    : ["docker compose", "docker-compose"];
  let last = { stdout: "", stderr: "", code: 127 };

  for (const composeCmd of candidates) {
    const result = await execOnVps(
      `cd ${shQuote(projectPath)} && ${buildManagedComposeInvocation(composeCmd, args)}`,
      conn
    );
    if (result.code === 0) return result;
    last = result;
  }
  return last;
}

export async function runDockerComposePipeline(
  projectPath: string,
  steps: string[],
  vps?: VpsConnection | null
) {
  const conn = vps || (await getActiveVps());
  const config = await getSystemConfig();
  const configured = config.composeCommand?.trim();
  const candidates = configured
    ? [configured]
    : ["docker compose", "docker-compose"];
  let last = { stdout: "", stderr: "", code: 127 };

  for (const composeCmd of candidates) {
    const command = steps
      .map((step) => buildManagedComposeInvocation(composeCmd, step))
      .join(" && ");
    const result = await execOnVps(`cd ${shQuote(projectPath)} && ${command}`, conn);
    if (result.code === 0) return result;
    last = result;
  }
  return last;
}

export async function runDockerComposeDown(
  projectPath: string,
  services?: string[],
  vps?: VpsConnection | null
) {
  const conn = vps || (await getActiveVps());
  const config = await getSystemConfig();
  const configured = config.composeCommand?.trim();
  const candidates = configured
    ? [configured]
    : ["docker compose", "docker-compose"];
  let last = { stdout: "", stderr: "", code: 127 };

  const svcArgs = Array.isArray(services) && services.length > 0
    ? services.map(shQuote).join(" ")
    : "";

  for (const composeCmd of candidates) {
    let result;
    if (svcArgs) {
      // Stopping specific services is more portable than `down <service>`.
      result = await execOnVps(
        `cd ${shQuote(projectPath)} && ${buildManagedComposeInvocation(composeCmd, `stop ${svcArgs}`)} && ${buildManagedComposeInvocation(composeCmd, `rm -f ${svcArgs}`)}`,
        conn
      );
    } else {
      result = await execOnVps(
        `cd ${shQuote(projectPath)} && ${buildManagedComposeInvocation(composeCmd, "down")}`,
        conn
      );
    }
    if (result.code === 0) return result;
    last = result;
  }
  return last;
}

/**
 * Build a POSIX-sh Compose invocation that includes GroundControl's managed
 * component environment override when it exists. Without the override it
 * behaves exactly like the repository's normal Compose command.
 */
export function buildManagedComposeInvocation(
  composeCommand: string,
  args: string,
  composeFile?: string
): string {
  const selectBase = composeFile
    ? `gc_compose_base=${shQuote(composeFile)}`
    : [
        `gc_compose_base=''`,
        `for gc_file in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do`,
        `  if [ -f "$gc_file" ]; then gc_compose_base="$gc_file"; break; fi`,
        `done`,
      ].join(" ");
  return [
    `(${selectBase};`,
    `if [ -n "$gc_compose_base" ] && [ -f .groundcontrol/compose.env.override.yml ]; then`,
    `  set -- -f "$gc_compose_base" -f .groundcontrol/compose.env.override.yml;`,
    `elif [ -n "$gc_compose_base" ] && [ -n ${shQuote(composeFile || "")} ]; then`,
    `  set -- -f "$gc_compose_base";`,
    `else set --; fi;`,
    `${composeCommand} "$@" ${args})`,
  ].join(" ");
}

export async function resolveComposeProjectPath(
  projectSlug: string,
  service?: string,
  vps?: VpsConnection | null
): Promise<{ projectPath: string; projectSlug: string; service?: string; source: "labels" | "config" }> {
  const config = await getSystemConfig();
  const labels = await getDockerContainerLabels(vps);
  const slug = projectSlug.toLowerCase();
  const serviceSlug = service?.toLowerCase();

  const byProject = labels.find((l) =>
    l.workingDir &&
    l.project.toLowerCase() === slug &&
    (!serviceSlug || l.service.toLowerCase() === serviceSlug)
  );
  if (byProject) {
    return {
      projectPath: byProject.workingDir,
      projectSlug: byProject.projectSlug || projectSlug,
      service: byProject.service || service,
      source: "labels",
    };
  }

  const byFolder = labels.find((l) => {
    if (!l.workingDir) return false;
    const dirSlug = l.workingDir.split("/").filter(Boolean).pop()?.toLowerCase();
    return dirSlug === slug && (!serviceSlug || l.service.toLowerCase() === serviceSlug);
  });
  if (byFolder) {
    return {
      projectPath: byFolder.workingDir,
      projectSlug: byFolder.projectSlug || projectSlug,
      service: byFolder.service || service,
      source: "labels",
    };
  }

  const dbProject = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (dbProject?.path) {
    return {
      projectPath: dbProject.path.replace(/\/+$/, ""),
      projectSlug,
      service,
      source: "config",
    };
  }

  return {
    projectPath: `${config.projectRoot.replace(/\/$/, "")}/${projectSlug}`,
    projectSlug,
    service,
    source: "config",
  };
}

export type BinaryResolution =
  | { type: "path"; path: string }
  | { type: "docker"; container: string }
  | { type: "not_found" };

export async function resolveBinary(
  name: string,
  vps?: VpsConnection | null,
  execFn: (command: string, vps?: VpsConnection | null, cwd?: string) => Promise<{ stdout: string; stderr: string; code: number }> = execOnVps
): Promise<BinaryResolution> {
  const conn = vps || (await getActiveVps());

  // Try `which` first (works on most systems)
  const which = await execFn(`which ${shQuote(name)} 2>/dev/null || echo ""`, conn);
  const path = which.stdout.trim();
  if (path && !path.includes("not found")) return { type: "path", path };

  // Try `command -v` (more portable on BusyBox/Alpine)
  const commandV = await execFn(`command -v ${shQuote(name)} 2>/dev/null || echo ""`, conn);
  const commandPath = commandV.stdout.trim();
  if (commandPath && commandPath.startsWith("/")) return { type: "path", path: commandPath };

  // Common fallback paths (Debian/Ubuntu/Alpine)
  const candidates = [
    `/usr/local/bin/${name}`,
    `/usr/local/sbin/${name}`,
    `/usr/bin/${name}`,
    `/usr/sbin/${name}`,
    `/bin/${name}`,
    `/sbin/${name}`,
    `/opt/${name}/${name}`,
    `/snap/bin/${name}`,
  ];
  for (const p of candidates) {
    const test = await execFn(`test -x ${shQuote(p)} && echo ${shQuote(p)} || echo ""`, conn);
    if (test.stdout.trim()) return { type: "path", path: test.stdout.trim() };
  }

  // Alpine: check if installed via apk
  const apk = await execFn(
    `apk info -L ${shQuote(name)} 2>/dev/null | grep -E ${shQuote(`(sbin|bin)/${name}$`)} || echo ""`,
    conn
  );
  if (apk.stdout.trim()) return { type: "path", path: apk.stdout.trim() };

  // Also try docker container name for caddy/nginx
  if (name === "caddy" || name === "nginx") {
    const docker = await execFn(
      `docker ps --format "{{.Names}}\t{{.Image}}" | awk -F '\\t' 'tolower($1) ~ /(^|[-_])${name}($|[-_])/ || tolower($2) ~ /(^|\\/|:)${name}(:|$)/ {print $1; exit}' || true`,
      conn
    );
    if (docker.stdout.trim()) return { type: "docker", container: docker.stdout.trim().split("\n")[0] };
  }

  return { type: "not_found" };
}

export async function controlContainer(
  action: "start" | "stop" | "restart" | "remove",
  containerName: string,
  vps?: VpsConnection | null
) {
  const conn = vps || (await getActiveVps());
  const dockerAction = action === "remove" ? "rm" : action;
  const result = await execOnVps(`docker ${dockerAction} ${shQuote(containerName)}`, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

export async function getDockerImages(vps?: VpsConnection | null) {
  const conn = vps || (await getActiveVps());
  const result = await execOnVps(
    `docker images --format "{{.Repository}}|{{.Tag}}|{{.ID}}|{{.Size}}|{{.CreatedAt}}"`,
    conn
  );
  if (!result.stdout.trim()) return [];

  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [repository, tag, id, size, createdAt] = line.split("|");
      return { repository, tag, id, size, createdAt };
    });
}

export async function pruneDocker(vps?: VpsConnection | null) {
  const conn = vps || (await getActiveVps());
  const result = await execOnVps("docker system prune -f", conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

export async function getSystemdServices(vps?: VpsConnection | null) {
  const conn = vps || (await getActiveVps());
  const result = await execOnVps(
    `systemctl list-units --type=service --state=running --no-pager --no-legend | awk '{print $1, $2, $3, $4}'`,
    conn
  );
  if (!result.stdout.trim()) return [];

  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts[0],
        load: parts[1],
        active: parts[2],
        sub: parts[3],
      };
    });
}

export async function scanProjects(vps?: VpsConnection | null) {
  const conn = vps || (await getActiveVps());
  const config = await getSystemConfig();

  // Scan project root directories
  const optResult = await execOnVps(
    `find ${shQuote(config.projectRoot)} -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null || ls -1 ${shQuote(config.projectRoot)} 2>/dev/null`,
    conn
  );
  const optDirs = optResult.stdout.trim().split("\n").filter(Boolean);

  // Scan Caddy sites — try all files in sites dir, not just .caddy extension
  const caddyResult = await execOnVps(
    `for f in ${shQuote(config.caddySitesDir)}/*; do [ -f "$f" ] && echo "---FILE:$f---" && cat "$f"; done 2>/dev/null || echo ""`,
    conn
  );

  // Also try the main Caddyfile if sites dir yielded nothing
  let mainCaddyfile = "";
  if (!caddyResult.stdout.trim()) {
    const mainResult = await execOnVps(
      `cat ${shQuote(config.caddyFile)} 2>/dev/null || echo ""`,
      conn
    );
    mainCaddyfile = mainResult.stdout;
  }

  // Parse Caddy configs to extract domains and roots
  const sites: any[] = [];
  const seenDomains = new Set<string>();

  function parseCaddyBlock(content: string, filePath: string) {
    // Caddy v2 block format: domain { ... }
    // Also handles :port, multiple domains on one line, and domain:port
    const blockRegex = /^(\S+(?:\.\S+)*)\s*\{([\s\S]*?)\n\}/gm;
    let m;
    while ((m = blockRegex.exec(content)) !== null) {
      const domain = m[1].trim();
      const blockContent = m[2];
      if (!domain || seenDomains.has(domain)) continue;
      // Skip raw port bindings and localhost unless they have a root/proxy
      const rootMatch = blockContent.match(/root\s+\*?\s+(\S+)/);
      const proxyMatch = blockContent.match(/reverse_proxy\s+(\S+)/);
      if (domain.match(/^:\d+$/) && !rootMatch && !proxyMatch) continue;
      seenDomains.add(domain);
      sites.push({
        file: filePath,
        domain,
        root: rootMatch ? rootMatch[1] : null,
        proxy: proxyMatch ? proxyMatch[1] : null,
        content: m[0],
      });
    }
  }

  if (caddyResult.stdout.trim()) {
    const blocks = caddyResult.stdout.split("---FILE:");
    for (const block of blocks) {
      if (!block.trim()) continue;
      const [filePath, ...contentLines] = block.split("\n");
      parseCaddyBlock(contentLines.join("\n"), filePath.replace("---", ""));
    }
  }

  if (mainCaddyfile.trim()) {
    parseCaddyBlock(mainCaddyfile, config.caddyFile);
  }

  return { optDirs, caddySites: sites };
}

export async function getDeploymentStatus(vps?: VpsConnection | null) {
  const conn = vps || (await getActiveVps());

  // Check latest github actions runs for known repos
  const projects = await prisma.project.findMany();
  const statuses = [];

  for (const project of projects) {
    if (!project.repoUrl) continue;
    // We'll check docker ps for containers matching project slug
    const containerResult = await execOnVps(
      `docker ps --filter "name=${project.slug}" --format "{{.Names}}|{{.Status}}|{{.Image}}"`,
      conn
    );
    const containers = containerResult.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, status, image] = line.split("|");
        return { name, status, image };
      });

    statuses.push({
      project: project.slug,
      domain: project.domain,
      containers,
      healthy: containers.some((c: any) => c.status.includes("Up") && !c.status.includes("unhealthy")),
    });
  }

  return statuses;
}
