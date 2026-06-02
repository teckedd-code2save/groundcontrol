"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/StatCard";
import HealthScore from "@/components/HealthScore";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface SystemStats {
  uptime: number;
  load: number[];
  memory: { used: number; total: number; free: number; percent: string };
  disk: { used: string; total: string; available: string; percent: string };
  cpuCount: number;
}

interface Container {
  name: string;
  image: string;
  status: string;
  state: string;
  stats?: { cpu: string; mem: string };
}

interface MetricSnapshot {
  id: number;
  cpuLoad1: number;
  cpuLoad5: number;
  memPercent: number;
  diskPercent: number;
  containerCount: number;
  runningContainers: number;
  unhealthyContainers: number;
  createdAt: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [metrics, setMetrics] = useState<MetricSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function collectMetrics() {
    try {
      await fetch("/api/metrics", { method: "POST" });
    } catch (err) {
      console.error("Failed to collect metrics", err);
    }
  }

  async function fetchData() {
    try {
      const [statsRes, containersRes, metricsRes] = await Promise.all([
        fetch("/api/vps/stats"),
        fetch("/api/containers"),
        fetch("/api/metrics?limit=60"),
      ]);
      if (!statsRes.ok) throw new Error("Failed to fetch stats");
      if (!containersRes.ok) throw new Error("Failed to fetch containers");
      const statsData = await statsRes.json();
      const containersData = await containersRes.json();
      const metricsData = await metricsRes.json();
      setStats(statsData);
      setContainers(containersData);
      setMetrics(metricsData.reverse());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    collectMetrics();
    const interval = setInterval(() => {
      fetchData();
      collectMetrics();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  };

  const runningContainers = containers.filter((c) => c.state === "running").length;
  const unhealthyContainers = containers.filter((c) => c.status.includes("unhealthy")).length;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted mt-1">Real-time overview of your Hetzner VPS</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
          {error}
        </div>
      )}

      {loading && !stats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 h-28 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              title="Uptime"
              value={stats ? formatUptime(stats.uptime) : "—"}
              subtitle={`${stats?.cpuCount || 0} CPU cores`}
              icon="◈"
            />
            <StatCard
              title="Memory"
              value={stats ? `${stats.memory.percent}%` : "—"}
              subtitle={`${stats?.memory.used || 0} / ${stats?.memory.total || 0} MB`}
              trend={stats && parseFloat(stats.memory.percent) > 85 ? "down" : "neutral"}
              icon="◉"
            />
            <StatCard
              title="Disk"
              value={stats ? `${stats.disk.percent}%` : "—"}
              subtitle={`${stats?.disk.used || 0} / ${stats?.disk.total || 0}`}
              trend={stats && parseFloat(stats.disk.percent) > 85 ? "down" : "neutral"}
              icon="◆"
            />
            <StatCard
              title="Containers"
              value={`${runningContainers} / ${containers.length}`}
              subtitle={unhealthyContainers > 0 ? `${unhealthyContainers} unhealthy` : "All healthy"}
              trend={unhealthyContainers > 0 ? "down" : "up"}
              icon="▶"
            />
          </div>

          <div className="mb-8">
            <HealthScore />
          </div>

          {/* Metrics Charts */}
          {metrics.length > 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">
                  CPU Load (1m) · Last hour
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={metrics}>
                    <defs>
                      <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff5500" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ff5500" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis
                      dataKey="createdAt"
                      tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      stroke="#666"
                      fontSize={10}
                    />
                    <YAxis stroke="#666" fontSize={10} />
                    <Tooltip
                      contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8 }}
                      labelFormatter={(v) => new Date(v).toLocaleString()}
                    />
                    <Area type="monotone" dataKey="cpuLoad1" stroke="#ff5500" fill="url(#cpuGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">
                  Memory % · Last hour
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={metrics}>
                    <defs>
                      <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#c77dff" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#c77dff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis
                      dataKey="createdAt"
                      tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      stroke="#666"
                      fontSize={10}
                    />
                    <YAxis stroke="#666" fontSize={10} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8 }}
                      labelFormatter={(v) => new Date(v).toLocaleString()}
                    />
                    <Area type="monotone" dataKey="memPercent" stroke="#c77dff" fill="url(#memGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Load Average */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Load Average</h3>
              <div className="flex gap-4">
                {stats?.load.map((load, i) => (
                  <div key={i} className="flex-1">
                    <div className="text-2xl font-bold">{load.toFixed(2)}</div>
                    <div className="text-xs text-muted mt-1">
                      {i === 0 ? "1m" : i === 1 ? "5m" : "15m"}
                    </div>
                    <div className="mt-2 h-2 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-500"
                        style={{ width: `${Math.min((load / (stats.cpuCount || 1)) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Container Quick View */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Container Health</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
                {containers.slice(0, 8).map((container) => (
                  <div
                    key={container.name}
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-background/50"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          container.state === "running"
                            ? container.status.includes("unhealthy")
                              ? "bg-warning"
                              : "bg-success"
                            : "bg-error"
                        }`}
                      />
                      <span className="text-sm font-medium">{container.name}</span>
                    </div>
                    <div className="text-xs text-muted font-mono">
                      {container.stats?.cpu || "—"}
                    </div>
                  </div>
                ))}
                {containers.length === 0 && (
                  <p className="text-sm text-muted py-4 text-center">No containers found</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
