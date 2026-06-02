import { NodeSSH } from "node-ssh";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "./prisma";

const execAsync = promisify(exec);

export interface VpsConnection {
  id: number;
  host: string;
  port: number;
  username: string;
  isLocal: boolean;
}

let sshCache: Map<number, NodeSSH> = new Map();

export async function getActiveVps(): Promise<VpsConnection | null> {
  const config = await prisma.vpsConfig.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (!config) return null;
  return {
    id: config.id,
    host: config.host,
    port: config.port,
    username: config.username,
    isLocal: config.isLocal,
  };
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
      const { stdout, stderr } = await execAsync(command, { timeout: 30000, cwd });
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
  let ssh = sshCache.get(conn.id);
  if (!ssh) {
    ssh = new NodeSSH();
    const config = await prisma.vpsConfig.findUnique({
      where: { id: conn.id },
    });
    if (!config) throw new Error("VPS config not found");

    const sshConfig: any = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 20000,
    };

    if (config.authType === "key" && config.privateKey) {
      sshConfig.privateKey = config.privateKey;
    } else if (config.password) {
      sshConfig.password = config.password;
    }

    await ssh.connect(sshConfig);
    sshCache.set(conn.id, ssh);
  }

  const result = await ssh.execCommand(command, { cwd: cwd || "/root" });
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
    const sshConfig: any = {
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
    await ssh.connect(sshConfig);
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

export async function getContainerLogs(
  containerName: string,
  tail: number = 100,
  vps?: VpsConnection | null
) {
  const conn = vps || (await getActiveVps());
  const result = await execOnVps(
    `docker logs --tail ${tail} ${containerName} 2>&1`,
    conn
  );
  return result.stdout;
}

export async function getDockerComposeCommand(vps?: VpsConnection | null): Promise<string> {
  const conn = vps || (await getActiveVps());
  // Try docker compose (plugin) first, fallback to docker-compose (standalone)
  const pluginCheck = await execOnVps("docker compose version 2>/dev/null", conn);
  if (pluginCheck.code === 0) {
    return "docker compose";
  }
  const standaloneCheck = await execOnVps("docker-compose version 2>/dev/null", conn);
  if (standaloneCheck.code === 0) {
    return "docker-compose";
  }
  // Default to plugin syntax; error will surface naturally if neither exists
  return "docker compose";
}

export async function resolveBinary(
  name: string,
  vps?: VpsConnection | null
): Promise<string> {
  const conn = vps || (await getActiveVps());
  // Try `which` first
  const which = await execOnVps(`which ${name} 2>/dev/null || echo ""`, conn);
  const path = which.stdout.trim();
  if (path) return path;

  // Common fallback paths
  const candidates = [
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/bin/${name}`,
    `/opt/${name}/${name}`,
    `/snap/bin/${name}`,
  ];
  for (const p of candidates) {
    const test = await execOnVps(`test -x ${p} && echo ${p} || echo ""`, conn);
    if (test.stdout.trim()) return test.stdout.trim();
  }

  // Also try docker container name for caddy/nginx
  if (name === "caddy" || name === "nginx") {
    const docker = await execOnVps(`docker ps --format "{{.Names}}" | grep -E "^${name}$" || echo ""`, conn);
    if (docker.stdout.trim()) return `docker exec ${docker.stdout.trim()}`;
  }

  return name; // fallback to bare name — error will surface naturally
}

export async function controlContainer(
  action: "start" | "stop" | "restart" | "remove",
  containerName: string,
  vps?: VpsConnection | null
) {
  const conn = vps || (await getActiveVps());
  const result = await execOnVps(`docker ${action} ${containerName}`, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
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

  // Scan /opt/ directories
  const optResult = await execOnVps(
    `ls -1 /opt/ 2>/dev/null`,
    conn
  );
  const optDirs = optResult.stdout.trim().split("\n").filter(Boolean);

  // Scan Caddy sites
  const caddyResult = await execOnVps(
    `for f in /etc/caddy/sites/*.caddy; do echo "---FILE:$f---"; cat "$f"; done`,
    conn
  );

  // Parse Caddy configs to extract domains and roots
  const sites: any[] = [];
  const blocks = caddyResult.stdout.split("---FILE:");
  for (const block of blocks) {
    if (!block.trim()) continue;
    const [filePath, ...contentLines] = block.split("\n");
    const content = contentLines.join("\n");
    const domainMatch = content.match(/^(\S+\.\S+)\s*\{/);
    const rootMatch = content.match(/root\s+\*?\s+(\S+)/);
    const proxyMatch = content.match(/reverse_proxy\s+(\S+)/);
    if (domainMatch) {
      sites.push({
        file: filePath.replace("---", ""),
        domain: domainMatch[1],
        root: rootMatch ? rootMatch[1] : null,
        proxy: proxyMatch ? proxyMatch[1] : null,
        content,
      });
    }
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
