"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/StatCard";
import HealthScore from "@/components/HealthScore";
import MemoryPanel from "@/components/MemoryPanel";
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
        items.push({ label: "Load", status: "critical", detail: `Load average is ${loadRatio.toFixed(2)}x CPU count. System overloaded.`, href: "/topology" });
      } else if (loadRatio > 1) {
        items.push({ label: "Load", status: "warn", detail: `Load average is ${loadRatio.toFixed(2)}x CPU count. Elevated but stable.`, href: "/topology" });
      } else {
        items.push({ label: "Load", status: "good", detail: `Load average is ${loadRatio.toFixed(2)}x CPU count. Idle capacity available.`, href: "/topology" });
      }
    }

    // Alerts
    const unreadAlerts = alerts.filter((a) => !a.read);
    if (unreadAlerts.length > 0) {
      items.push({ label: "Alerts", status: "warn", detail: `${unreadAlerts.length} unread alert${unreadAlerts.length > 1 ? "s" : ""} require attention.`, href: "/alerts" });
    } else if (alerts.length > 0) {
      items.push({ label: "Alerts", status: "good", detail: "All alerts reviewed. Systems stable.", href: "/alerts" });
    }

    const criticalCount = items.filter((i) => i.status === "critical").length;
    const warnCount = items.filter((i) => i.status === "warn").length;

    let title = "All systems operational";
    if (criticalCount > 0) title = `${criticalCount} critical issue${criticalCount > 1 ? "s" : ""} need immediate attention`;
    else if (warnCount > 0) title = `${warnCount} warning${warnCount > 1 ? "s" : ""} detected — review recommended`;

    return { title, items };
  }

  const intelligence = generateIntelligence();

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
          {/* AI Summary */}
          <div className="bg-card border border-border rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                  <path d="M12 12L2.5 8.5" />
                </svg>
                <h2 className="text-sm font-mono uppercase tracking-wider text-muted">AI Summary</h2>
              </div>
              <button
                onClick={investigateWithAi}
                disabled={synthesisLoading && !synthesis}
                className="text-xs font-mono px-3 py-1.5 border border-accent/30 text-accent rounded-lg hover:bg-accent/10 transition-colors disabled:opacity-50"
              >
                Investigate
              </button>
            </div>
            {synthesisLoading && !synthesis ? (
              <div className="space-y-2">
                <div className="h-4 bg-border rounded w-3/4 animate-pulse" />
                <div className="h-3 bg-border rounded w-1/2 animate-pulse" />
              </div>
            ) : synthesisError ? (
              <p className="text-sm text-muted">{synthesisError}</p>
            ) : synthesis ? (
              <div>
                <p className="text-sm font-medium leading-relaxed">{synthesis.summary}</p>
                {(synthesis.rootCauses.length > 0 || synthesis.actions.length > 0) && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    {synthesis.rootCauses.length > 0 && (
                      <div>
                        <p className="font-mono text-muted mb-1 uppercase tracking-wider">Root Causes</p>
                        <ul className="space-y-1 list-disc list-inside text-muted">
                          {synthesis.rootCauses.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {synthesis.actions.length > 0 && (
                      <div>
                        <p className="font-mono text-muted mb-1 uppercase tracking-wider">Recommended Actions</p>
                        <ul className="space-y-1 list-disc list-inside text-muted">
                          {synthesis.actions.map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Intelligence Overview */}
          <div className="bg-card border border-border rounded-xl p-5 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
                <path d="M12 2a10 10 0 0 1 10 10" />
                <path d="M12 12L2.5 8.5" />
              </svg>
              <h2 className="text-sm font-mono uppercase tracking-wider text-muted">Intelligence Overview</h2>
            </div>
            <h3 className="text-lg font-medium mb-3">{intelligence.title}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {intelligence.items.map((item) => {
                const className = `flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  item.status === "critical"
                    ? "bg-error/5 border-error/20 hover:bg-error/10"
                    : item.status === "warn"
                    ? "bg-warning/5 border-warning/20 hover:bg-warning/10"
                    : "bg-success/5 border-success/20 hover:bg-success/10"
                }`;
                const content = (
                  <>
                    <div
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        item.status === "critical" ? "bg-error" : item.status === "warn" ? "bg-warning" : "bg-success"
                      }`}
                    />
                    <div>
                      <div className="text-xs font-mono font-medium">{item.label}</div>
                      <div className="text-[11px] text-muted mt-0.5 leading-relaxed">{item.detail}</div>
                    </div>
                  </>
                );
                if (item.action) {
                  return (
                    <button key={item.label} onClick={item.action} className={className + " text-left w-full"}>
                      {content}
                    </button>
                  );
                }
                return (
                  <a key={item.label} href={item.href} className={className}>
                    {content}
                  </a>
                );
              })}
            </div>
          </div>

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
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-mono uppercase tracking-wider text-muted">Container Health</h3>
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
                        <div>
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
