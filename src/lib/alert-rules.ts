import { prisma } from "./prisma";

export type MetricKey =
  | "cpu_load_1"
  | "mem_percent"
  | "disk_percent"
  | "unhealthy_containers"
  | "container_down";

export interface AlertRuleInput {
  name: string;
  metric: MetricKey;
  operator: ">" | "<" | "==" | ">=" | "<=";
  threshold: number;
  durationSec?: number;
  severity?: "info" | "warning" | "error" | "critical";
  enabled?: boolean;
}

const OPERATORS: Record<string, (a: number, b: number) => boolean> = {
  ">": (a, b) => a > b,
  "<": (a, b) => a < b,
  "==": (a, b) => a === b,
  ">=": (a, b) => a >= b,
  "<=": (a, b) => a <= b,
};

function getMetricValue(snapshot: {
  cpuLoad1: number;
  memPercent: number;
  diskPercent: number;
  unhealthyContainers: number;
  runningContainers: number;
  containerCount: number;
}, metric: MetricKey): number {
  switch (metric) {
    case "cpu_load_1":
      return snapshot.cpuLoad1;
    case "mem_percent":
      return snapshot.memPercent;
    case "disk_percent":
      return snapshot.diskPercent;
    case "unhealthy_containers":
      return snapshot.unhealthyContainers;
    case "container_down":
      return snapshot.containerCount - snapshot.runningContainers;
    default:
      return 0;
  }
}

export async function evaluateAlertRules() {
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } });
  if (rules.length === 0) return [];

  const latest = await prisma.metricSnapshot.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (!latest) return [];

  const created: Array<{
    id: number;
    title: string;
    message: string;
    severity: string;
    source: string;
    createdAt: Date;
  }> = [];

  for (const rule of rules) {
    const value = getMetricValue(latest, rule.metric as MetricKey);
    const opFn = OPERATORS[rule.operator];
    if (!opFn) continue;

    const breached = opFn(value, rule.threshold);
    if (!breached) continue;

    // Duration support: look back N consecutive snapshots all breaching.
    const lookbackCount = Math.max(1, Math.ceil(rule.durationSec / 60));
    const recent = await prisma.metricSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: lookbackCount,
    });
    const allBreached = recent.length >= lookbackCount && recent.every((s) => {
      const v = getMetricValue(s, rule.metric as MetricKey);
      return opFn(v, rule.threshold);
    });
    if (!allBreached) continue;

    const title = rule.name;
    const message = `${rule.metric} is ${value} (threshold: ${rule.operator} ${rule.threshold})`;

    // Deduplicate: don't create the exact same alert within 15 minutes.
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const existing = await prisma.alert.findFirst({
      where: {
        title,
        message,
        severity: rule.severity,
        source: "alert-rule",
        createdAt: { gte: fifteenMinutesAgo },
      },
    });

    if (!existing) {
      const alert = await prisma.alert.create({
        data: {
          title,
          message,
          severity: rule.severity,
          source: "alert-rule",
        },
      });
      created.push(alert);
    }
  }

  return created;
}

export async function cleanupOldAlerts() {
  const settings = await prisma.alertSetting.findFirst();
  const retentionDays = settings?.retentionDays ?? 30;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.alert.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

export async function getOrCreateAlertSettings() {
  let settings = await prisma.alertSetting.findFirst();
  if (!settings) {
    settings = await prisma.alertSetting.create({ data: {} });
  }
  return settings;
}
