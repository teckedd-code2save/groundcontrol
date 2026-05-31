import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSystemStats, getDockerContainers } from "@/lib/vps";
import { createAlert } from "@/lib/alerts";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "100");

  try {
    const metrics = await prisma.metricSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json(metrics);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const stats = await getSystemStats();
    const containers = await getDockerContainers();
    const running = containers.filter((c) => c.state === "running").length;
    const unhealthy = containers.filter((c) => c.status.includes("unhealthy")).length;

    const snapshot = await prisma.metricSnapshot.create({
      data: {
        cpuLoad1: stats.load[0] || 0,
        cpuLoad5: stats.load[1] || 0,
        cpuLoad15: stats.load[2] || 0,
        memUsed: stats.memory.used,
        memTotal: stats.memory.total,
        memPercent: parseFloat(stats.memory.percent),
        diskUsed: parseFloat(stats.disk.percent),
        diskTotal: parseFloat(stats.disk.percent),
        diskPercent: parseFloat(stats.disk.percent),
        containerCount: containers.length,
        runningContainers: running,
        unhealthyContainers: unhealthy,
      },
    });

    // Generate alerts for critical conditions
    const memPercent = parseFloat(stats.memory.percent);
    const diskPercent = parseFloat(stats.disk.percent);

    if (memPercent > 90) {
      await createAlert({
        title: "High Memory Usage",
        message: `Memory usage is at ${memPercent}%. Consider restarting containers or scaling up.`,
        severity: "critical",
        source: "metrics",
      });
    } else if (memPercent > 80) {
      await createAlert({
        title: "Elevated Memory Usage",
        message: `Memory usage is at ${memPercent}%.`,
        severity: "warning",
        source: "metrics",
      });
    }

    if (diskPercent > 90) {
      await createAlert({
        title: "High Disk Usage",
        message: `Disk usage is at ${diskPercent}%. Clean up logs and old images to free space.`,
        severity: "critical",
        source: "metrics",
      });
    } else if (diskPercent > 80) {
      await createAlert({
        title: "Elevated Disk Usage",
        message: `Disk usage is at ${diskPercent}%.`,
        severity: "warning",
        source: "metrics",
      });
    }

    if (unhealthy > 0) {
      const names = containers.filter((c) => c.status.includes("unhealthy")).map((c) => c.name).join(", ");
      await createAlert({
        title: "Unhealthy Containers",
        message: `${unhealthy} container(s) unhealthy: ${names}`,
        severity: "error",
        source: "containers",
      });
    }

    return NextResponse.json(snapshot);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
