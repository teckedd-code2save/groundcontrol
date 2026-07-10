"use client";

import { useEffect, useState } from "react";
import MemoryPanel from "@/components/MemoryPanel";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { ContainerIcon, getContainerType } from "@/components/TopoIcons";
import { PageHeader } from "@/components/PageHeader";
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

interface Alert {
  id: number;
  title: string;
  message: string;
  severity: string;
  source: string;
  read: boolean;
  createdAt: string;
}

interface SynthesisResult {
  summary: string;
  rootCauses: string[];
  actions: string[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [metrics, setMetrics] = useState<MetricSnapshot[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [synthesisError, setSynthesisError] = useState("");

  async function collectMetrics() {
    try {
      await fetch("/api/metrics", { method: "POST" });
    } catch (err) {
      console.error("Failed to collect metrics", err);
    }
  }

  async function fetchData() {
    try {
      const [statsRes, containersRes, metricsRes, alertsRes] = await Promise.all([
        fetch("/api/vps/stats"),
        fetch("/api/containers"),
        fetch("/api/metrics?limit=60"),
        fetch("/api/alerts?limit=10"),
      ]);
      if (!statsRes.ok) throw new Error("Failed to fetch stats");
      if (!containersRes.ok) throw new Error("Failed to fetch containers");
      const statsData = await statsRes.json();
      const containersData = await containersRes.json();
      const metricsData = await metricsRes.json();
      const alertsData = await alertsRes.json();
      setStats(statsData);
      setContainers(containersData);
      setMetrics(metricsData.reverse());
      setAlerts(alertsData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function fetchSynthesis() {
    setSynthesisLoading(true);
    setSynthesisError("");
    try {
      const res = await fetch("/api/alerts/synthesize");
      const data = await res.json();
      if (res.ok) {
        setSynthesis(data);
      } else {
        setSynthesisError(data.summary || "AI synthesis unavailable");
      }
    } catch (err: unknown) {
      setSynthesisError(err instanceof Error ? err.message : String(err));
    } finally {
      setSynthesisLoading(false);
    }
  }

  function investigateWithAi() {
    const unread = alerts.filter((a) => !a.read);
    const query =
      unread.length > 0
        ? `Investigate alerts: ${unread.map((a) => a.title).join(", ")}`
        : synthesis?.summary
          ? `Investigate: ${synthesis.summary}`
          : "Investigate current system status";
    window.dispatchEvent(new CustomEvent("gc:ai-chat-query", { detail: query }));
  }

  useEffect(() => {
    async function load() {
      await fetchData();
      await collectMetrics();
      await fetchSynthesis();
    }
    load();
    const interval = setInterval(() => {
      fetchData();
      collectMetrics();
    }, 30000);
    const synthesisInterval = setInterval(fetchSynthesis, 60000);
    return () => {
      clearInterval(interval);
      clearInterval(synthesisInterval);
    };
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  };

  const runningContainers = containers.filter((c) => c.state === "running").length;
  const unhealthyContainers = containers.filter((c) => c.status.includes("unhealthy")).length;
  const stoppedContainers = containers.filter((c) => c.state !== "running").length;
  const counts = {
    running: runningContainers,
    stopped: stoppedContainers,
    unhealthy: unhealthyContainers,
  };

  function generateIntelligence(): { title: string; items: { label: string; status: "good" | "warn" | "critical"; detail: string; href?: string; action?: () => void }[] } {
    const items: { label: string; status: "good" | "warn" | "critical"; detail: string; href?: string; action?: () => void }[] = [];

    // Containers
    if (containers.length === 0) {
      items.push({ label: "Containers", status: "warn", detail: "No containers detected. Docker may not be running.", href: "/containers" });
    } else if (stoppedContainers > 0) {
      items.push({ label: "Containers", status: "critical", detail: `${stoppedContainers} of ${containers.length} containers are stopped.`, href: "/containers" });
    } else if (unhealthyContainers > 0) {
      items.push({ label: "Containers", status: "warn", detail: `${unhealthyContainers} container${unhealthyContainers > 1 ? "s" : ""} failing health checks.`, href: "/containers" });
    } else {
      items.push({ label: "Containers", status: "good", detail: `${runningContainers} containers running smoothly.`, href: "/containers" });
    }

    // Memory
    if (stats) {
      const memPct = parseFloat(stats.memory.percent);
      if (memPct > 90) {
        items.push({ label: "Memory", status: "critical", detail: `Usage at ${memPct}%. System may become unstable.`, action: () => setMemoryPanelOpen(true) });
      } else if (memPct > 75) {
        items.push({ label: "Memory", status: "warn", detail: `Usage at ${memPct}%. Monitor closely.`, action: () => setMemoryPanelOpen(true) });
      } else {
        items.push({ label: "Memory", status: "good", detail: `Usage at ${memPct}%. Plenty of headroom.` });
      }
    }

    // Disk
    if (stats) {
      const diskPct = parseFloat(stats.disk.percent);
      if (diskPct > 90) {
        items.push({ label: "Disk", status: "critical", detail: `Usage at ${diskPct}%. Clean up logs and prune Docker.`, action: () => setMemoryPanelOpen(true) });
      } else if (diskPct > 75) {
        items.push({ label: "Disk", status: "warn", detail: `Usage at ${diskPct}%. Consider pruning unused images.`, action: () => setMemoryPanelOpen(true) });
      } else {
        items.push({ label: "Disk", status: "good", detail: `Usage at ${diskPct}%. Healthy capacity.` });
      }
    }

    // Load
    if (stats) {
      const loadRatio = (stats.load[0] || 0) / (stats.cpuCount || 1);
      if (loadRatio > 2) {
        items.push({ label: "Load", status: "critical", detail: `Load average is ${loadRatio.toFixed(2)}x CPU count. System overloaded.`, href: "/processes" });
      } else if (loadRatio > 1) {
        items.push({ label: "Load", status: "warn", detail: `Load average is ${loadRatio.toFixed(2)}x CPU count. Elevated but stable.`, href: "/processes" });
      } else {
        items.push({ label: "Load", status: "good", detail: `Load average is ${loadRatio.toFixed(2)}x CPU count. Idle capacity available.`, href: "/processes" });
      }
    }

    // Alerts
    const unreadAlerts = alerts.filter((a) => !a.read);
    if (unreadAlerts.length > 0) {
      items.push({ label: "Alerts", status: "warn", detail: `${unreadAlerts.length} unread alert${unreadAlerts.length > 1 ? "s" : ""} require attention.`, href: "/settings?tab=alerts" });
    } else if (alerts.length > 0) {
      items.push({ label: "Alerts", status: "good", detail: "All alerts reviewed. Systems stable.", href: "/settings?tab=alerts" });
    } else {
      items.push({ label: "Alerts", status: "good", detail: "No alerts. Configure rules in Settings.", href: "/settings?tab=alerts" });
    }

    const criticalCount = items.filter((i) => i.status === "critical").length;
    const warnCount = items.filter((i) => i.status === "warn").length;

    let title = "All systems operational";
    if (criticalCount > 0) title = `${criticalCount} critical issue${criticalCount > 1 ? "s" : ""} need immediate attention`;
    else if (warnCount > 0) title = `${warnCount} warning${warnCount > 1 ? "s" : ""} detected — review recommended`;

    return { title, items };
  }

  const intelligence = generateIntelligence();
  const priorityItems = intelligence.items.filter((item) => item.status !== "good").slice(0, 2);
  const calmItems = priorityItems.length > 0 ? priorityItems : intelligence.items.slice(0, 1);

  const topMetrics = [
    { label: "Memory", value: stats ? `${stats.memory.percent}%` : "—", detail: `${stats?.memory.used || 0}/${stats?.memory.total || 0} MB`, tone: stats && parseFloat(stats.memory.percent) > 85 ? "text-error" : "text-foreground" },
    { label: "Disk", value: stats ? `${stats.disk.percent}%` : "—", detail: `${stats?.disk.used || 0}/${stats?.disk.total || 0}`, tone: stats && parseFloat(stats.disk.percent) > 85 ? "text-error" : "text-foreground" },
    { label: "Load", value: stats ? (stats.load[0] || 0).toFixed(2) : "—", detail: `${stats?.cpuCount || 0} cores`, tone: "text-foreground" },
    { label: "Containers", value: `${runningContainers}/${containers.length}`, detail: unhealthyContainers > 0 ? `${unhealthyContainers} unhealthy` : `${stoppedContainers} stopped`, tone: unhealthyContainers > 0 ? "text-error" : "text-success" },
  ];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PageHeader
          className="mb-0"
          title="Dashboard"
          description="Status, priority attention, and the next safe action."
        />
        <div className="flex flex-wrap gap-2 text-[10px] font-mono text-muted">
          <span className="rounded-md bg-card px-2.5 py-1.5">
            uptime <span className="text-foreground">{stats ? formatUptime(stats.uptime) : "—"}</span>
          </span>
          <span className="rounded-lg bg-card px-2.5 py-1.5">
            cores <span className="text-foreground">{stats?.cpuCount || 0}</span>
          </span>
          <span className="rounded-lg bg-card px-2.5 py-1.5">
            containers <span className="text-success">{runningContainers}</span>/<span className="text-foreground">{containers.length}</span>
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
          {error}
        </div>
      )}

      <LoaderOverlay3D open={loading && !stats} variant="container" title="Loading dashboard..." />

      {loading && !stats ? null : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {topMetrics.map((metric) => (
              <button
                key={metric.label}
                onClick={metric.label === "Memory" || metric.label === "Disk" ? () => setMemoryPanelOpen(true) : undefined}
                className="rounded-lg bg-card px-3 py-2 text-left transition-colors hover:bg-card/80"
              >
                <span className="block text-[10px] font-mono text-muted">{metric.label}</span>
                <span className={`mt-0.5 block text-lg font-semibold ${metric.tone}`}>{metric.value}</span>
                <span className="mt-0.5 block truncate text-[10px] text-muted">{metric.detail}</span>
              </button>
            ))}
          </div>

          <div className="mb-5 rounded-xl bg-card p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="text-[10px] font-mono text-muted">Attention</div>
                <div className="mt-1 truncate text-sm font-medium">{intelligence.title}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {calmItems.map((item) => {
                  const tone = item.status === "critical" ? "text-error bg-error/10" : item.status === "warn" ? "text-warning bg-warning/10" : "text-success bg-success/10";
                  const content = (
                    <span className={`inline-flex max-w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-mono ${tone}`}>
                      <span className="truncate">{item.label}: {item.detail}</span>
                    </span>
                  );
                  if (item.action) {
                    return <button key={item.label} onClick={item.action} className="max-w-full">{content}</button>;
                  }
                  return <a key={item.label} href={item.href} className="max-w-full">{content}</a>;
                })}
              </div>
              <button
                onClick={investigateWithAi}
                disabled={synthesisLoading && !synthesis}
                className="shrink-0 rounded-lg bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
              >
                Investigate
              </button>
            </div>
            {(synthesis || synthesisError) && (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer font-mono text-[10px] text-muted">Assistant note</summary>
                <p className="mt-2 leading-relaxed">{synthesis?.summary || synthesisError}</p>
                {synthesis?.actions.length ? (
                  <ul className="mt-2 space-y-1">
                    {synthesis.actions.slice(0, 3).map((action, index) => <li key={index}>{action}</li>)}
                  </ul>
                ) : null}
              </details>
            )}
          </div>

          {/* Metrics Charts */}
          {metrics.length > 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-mono text-muted mb-4">
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
                <h3 className="text-sm font-mono text-muted mb-4">
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
              <h3 className="text-sm font-mono text-muted mb-4">Load Average</h3>
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
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-mono text-muted">Container Health</h3>
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="text-success">{counts.running} up</span>
                  {counts.stopped > 0 && <span className="text-error">{counts.stopped} down</span>}
                  {counts.unhealthy > 0 && <span className="text-warning">{counts.unhealthy} sick</span>}
                </div>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
                {containers.map((container) => {
                  const isStopped = container.state !== "running";
                  const isUnhealthy = container.status.includes("unhealthy");
                  return (
                    <a
                      key={container.name}
                      href={`/containers`}
                      className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${
                        isStopped ? "bg-error/5 border border-error/10 hover:bg-error/10" : "bg-background/50 hover:bg-background"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            container.state === "running"
                              ? isUnhealthy
                                ? "bg-warning"
                                : "bg-success"
                              : "bg-error"
                          }`}
                        />
                        <div className="flex items-center gap-2">
                          <ContainerIcon type={getContainerType(container.name, container.image)} className="w-4 h-4 text-muted" />
                          <span className={`text-sm font-medium ${isStopped ? "text-error/80" : ""}`}>{container.name}</span>
                          {isStopped && (
                            <span className="ml-2 text-[10px] font-mono text-error">stopped</span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted font-mono">
                        {container.stats?.cpu || (isStopped ? "—" : "—")}
                      </div>
                    </a>
                  );
                })}
                {containers.length === 0 && (
                  <p className="text-sm text-muted py-4 text-center">No containers found</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      <MemoryPanel open={memoryPanelOpen} onClose={() => setMemoryPanelOpen(false)} />
    </div>
  );
}
