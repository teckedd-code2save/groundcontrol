import { prisma } from "./prisma";
import { getDockerContainers, type VpsConnection } from "./vps";
import { createAlert } from "./alerts";

export type HealthStatus = "healthy" | "unhealthy" | "down";
export type CheckSeverity = "info" | "warning" | "error" | "critical";

export interface ContainerHealthResult {
  name: string;
  status: HealthStatus;
  detail: string;
}

export interface HealthCheckSummary {
  total: number;
  healthy: number;
  unhealthy: number;
  down: number;
  results: ContainerHealthResult[];
  overall: "ok" | "degraded" | "down";
}

export const MIN_INTERVAL_SEC = 30;
export const MAX_INTERVAL_SEC = 3600;

export function clampInterval(seconds: number): number {
  const n = Math.floor(Number(seconds) || 0);
  if (n < MIN_INTERVAL_SEC) return MIN_INTERVAL_SEC;
  if (n > MAX_INTERVAL_SEC) return MAX_INTERVAL_SEC;
  return n;
}

export async function getOrCreateHealthCheckConfig() {
  let config = await prisma.healthCheckConfig.findFirst();
  if (!config) {
    config = await prisma.healthCheckConfig.create({ data: {} });
  }
  return config;
}

export function classifyContainer(container: {
  state?: string;
  status?: string;
  name: string;
}): ContainerHealthResult {
  const state = (container.state || "").toLowerCase();
  const status = (container.status || "").toLowerCase();
  const name = container.name;

  if (state === "running" && status.includes("unhealthy")) {
    return { name, status: "unhealthy", detail: `Running but failing health checks (${status})` };
  }
  if (state === "running" && !status.includes("unhealthy")) {
    return { name, status: "healthy", detail: "" };
  }
  if (state === "exited" || state === "dead" || state === "stopped" || state === "created") {
    return { name, status: "down", detail: `Container is ${state} (status: ${status || "n/a"})` };
  }
  if (state === "restarting" || state === "paused") {
    return { name, status: "unhealthy", detail: `Container is in ${state} state` };
  }
  // Unknown state — treat as unhealthy so the user is aware.
  return { name, status: "unhealthy", detail: `Unrecognized container state: ${state || "unknown"}` };
}

export function summarizeHealth(results: ContainerHealthResult[]): HealthCheckSummary {
  const healthy = results.filter((r) => r.status === "healthy").length;
  const unhealthy = results.filter((r) => r.status === "unhealthy").length;
  const down = results.filter((r) => r.status === "down").length;
  const total = results.length;

  let overall: "ok" | "degraded" | "down" = "ok";
  if (down > 0) {
    overall = "down";
  } else if (unhealthy > 0) {
    overall = "degraded";
  }

  return { total, healthy, unhealthy, down, results, overall };
}

export async function runHealthCheck(
  vps?: VpsConnection | null,
  fetchContainers?: () => Promise<Array<{ name: string; state?: string; status?: string }>>
): Promise<HealthCheckSummary> {
  const config = await getOrCreateHealthCheckConfig();
  const getContainers = fetchContainers || (async () => {
    const containers = await getDockerContainers(vps);
    return containers.map((c) => ({ name: c.name, state: c.state, status: c.status }));
  });

  const rawContainers = await getContainers();
  const results = rawContainers.map(classifyContainer);
  const summary = summarizeHealth(results);

  // Persist individual results for history.
  if (results.length > 0) {
    await prisma.healthCheckResult.createMany({
      data: results.map((r) => ({
        containerName: r.name,
        status: r.status,
        detail: r.detail,
      })),
    });
  }

  // Prune results older than 7 days to avoid unbounded growth.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.healthCheckResult.deleteMany({
    where: { checkedAt: { lt: sevenDaysAgo } },
  });

  // Generate alerts based on severity and dedup via createAlert.
  const severity = (config.severity || "error") as CheckSeverity;

  if (summary.down > 0) {
    const downNames = results
      .filter((r) => r.status === "down")
      .map((r) => r.name)
      .join(", ");
    await createAlert({
      title: "Container Down",
      message: `${summary.down} container(s) are down: ${downNames}`,
      severity: severity === "info" ? "warning" : severity,
      source: "health-check",
    });
  }

  if (summary.unhealthy > 0) {
    const unhealthyNames = results
      .filter((r) => r.status === "unhealthy")
      .map((r) => r.name)
      .join(", ");
    await createAlert({
      title: "Unhealthy Containers",
      message: `${summary.unhealthy} container(s) are unhealthy: ${unhealthyNames}`,
      severity: severity === "critical" ? "critical" : "warning",
      source: "health-check",
    });
  }

  // Update config with last run metadata.
  await prisma.healthCheckConfig.update({
    where: { id: config.id },
    data: {
      lastRunAt: new Date(),
      lastStatus: summary.overall,
    },
  });

  return summary;
}

export async function getRecentHealthResults(limit = 200) {
  return prisma.healthCheckResult.findMany({
    orderBy: { checkedAt: "desc" },
    take: Math.min(Math.max(1, limit), 1000),
  });
}
