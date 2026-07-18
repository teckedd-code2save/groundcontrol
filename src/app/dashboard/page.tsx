"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MemoryPanel from "@/components/MemoryPanel";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { ContainerIcon, getContainerType } from "@/components/TopoIcons";
import { PageHeader } from "@/components/PageHeader";
import { ArrowUpRight, Bot, ChevronRight } from "lucide-react";
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
  const attentionItems = priorityItems.length > 0 ? priorityItems : intelligence.items.slice(0, 3);
  const overallState = intelligence.items.some((item) => item.status === "critical")
    ? "critical"
    : intelligence.items.some((item) => item.status === "warn")
      ? "warning"
      : "healthy";

  const topMetrics = [
    { label: "Memory", value: stats ? `${stats.memory.percent}%` : "—", detail: `${stats?.memory.used || 0}/${stats?.memory.total || 0} MB`, tone: stats && parseFloat(stats.memory.percent) > 85 ? "text-error" : "text-foreground" },
    { label: "Disk", value: stats ? `${stats.disk.percent}%` : "—", detail: `${stats?.disk.used || 0}/${stats?.disk.total || 0}`, tone: stats && parseFloat(stats.disk.percent) > 85 ? "text-error" : "text-foreground" },
    { label: "Load", value: stats ? (stats.load[0] || 0).toFixed(2) : "—", detail: `${stats?.cpuCount || 0} cores`, tone: "text-foreground" },
    { label: "Containers", value: `${runningContainers}/${containers.length}`, detail: unhealthyContainers > 0 ? `${unhealthyContainers} unhealthy` : `${stoppedContainers} stopped`, tone: unhealthyContainers > 0 ? "text-error" : "text-success" },
  ];

  return (
    <div className="gc-page gc-page--wide">
      <PageHeader
        eyebrow="Fleet overview"
        title="Operations"
        description="Customer-impact signals first, with host telemetry and raw controls close behind."
        actions={(
          <div className="flex items-center gap-3 font-mono text-[10px] text-muted">
            <span>UPTIME <span className="text-foreground">{stats ? formatUptime(stats.uptime) : "—"}</span></span>
            <span className="h-3 w-px bg-border" />
            <span>{stats?.cpuCount || 0} CORES</span>
          </div>
        )}
      />

      {error && (
        <div className="mb-6 rounded-sm border border-error/30 bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      )}

      <LoaderOverlay3D open={loading && !stats} variant="container" title="Loading dashboard..." />

      {loading && !stats ? null : (
        <div className="space-y-5">
          <section className="gc-panel overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
              <div className="flex min-h-[270px] flex-col justify-between border-b border-border p-6 lg:border-b-0 lg:border-r lg:p-8">
                <div>
                  <span className={`gc-status gc-status--${overallState}`}>
                    {overallState === "healthy" ? "Verified operational state" : overallState === "warning" ? "Review recommended" : "Action required"}
                  </span>
                  <h2 className="mt-5 max-w-2xl text-3xl font-medium leading-[1.08] tracking-[-0.045em] md:text-[38px]">{intelligence.title}</h2>
                  <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
                    {attentionItems[0]?.detail || "GroundControl has not found a current customer-impacting signal."}
                  </p>
                </div>
                <div className="mt-8 flex flex-wrap gap-2">
                  <Link href="/intelligence" className="gc-button gc-button-primary">Open Intelligence <ArrowUpRight className="h-3.5 w-3.5" /></Link>
                  <Link href="/alerts" className="gc-button gc-button-secondary">Review alerts</Link>
                  <button type="button" onClick={investigateWithAi} disabled={synthesisLoading && !synthesis} className="gc-button gc-button-quiet"><Bot className="h-3.5 w-3.5" /> Ask assistant</button>
                </div>
              </div>
              <div className="grid grid-cols-2 bg-background/30">
                {topMetrics.map((metric, index) => (
                  <button
                    key={metric.label}
                    type="button"
                    onClick={metric.label === "Memory" || metric.label === "Disk" ? () => setMemoryPanelOpen(true) : undefined}
                    className={`min-h-[134px] p-5 text-left transition-colors hover:bg-white/[0.025] ${index % 2 === 0 ? "border-r border-border" : ""} ${index < 2 ? "border-b border-border" : ""}`}
                  >
                    <span className="gc-eyebrow">{metric.label}</span>
                    <span className={`mt-3 block text-[28px] font-medium tracking-[-0.04em] ${metric.tone}`}>{metric.value}</span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-muted">{metric.detail}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
            <section className="gc-panel min-w-0 overflow-hidden">
              <div className="gc-panel-header">
                <div>
                  <p className="gc-eyebrow">Host telemetry</p>
                  <h3 className="mt-1 text-sm font-medium">Last hour</h3>
                </div>
                <Link href="/processes" className="flex items-center gap-1 text-[11px] text-muted hover:text-foreground">Processes <ChevronRight className="h-3.5 w-3.5" /></Link>
              </div>
              {metrics.length > 1 ? (
                <div className="grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                  <div className="min-w-0 p-4">
                    <p className="mb-3 font-mono text-[10px] text-muted">CPU LOAD · 1 MIN</p>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={metrics}>
                    <defs>
                      <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4e5fd5" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="#4e5fd5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#2a302b" />
                    <XAxis
                      dataKey="createdAt"
                      tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      stroke="#626960"
                      fontSize={10}
                    />
                    <YAxis stroke="#626960" fontSize={10} />
                    <Tooltip
                      contentStyle={{ background: "#0b0e0c", border: "1px solid #3a423b", borderRadius: 4, fontSize: 11 }}
                      labelFormatter={(v) => new Date(v).toLocaleString()}
                    />
                    <Area type="monotone" dataKey="cpuLoad1" stroke="#4e5fd5" fill="url(#cpuGrad)" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
                  </div>
                  <div className="min-w-0 p-4">
                    <p className="mb-3 font-mono text-[10px] text-muted">MEMORY · PERCENT</p>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={metrics}>
                    <defs>
                      <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#e7b75b" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#e7b75b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#2a302b" />
                    <XAxis
                      dataKey="createdAt"
                      tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      stroke="#626960"
                      fontSize={10}
                    />
                    <YAxis stroke="#626960" fontSize={10} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ background: "#0b0e0c", border: "1px solid #3a423b", borderRadius: 4, fontSize: 11 }}
                      labelFormatter={(v) => new Date(v).toLocaleString()}
                    />
                    <Area type="monotone" dataKey="memPercent" stroke="#e7b75b" fill="url(#memGrad)" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-sm text-muted">Telemetry history will appear after the next collection interval.</div>
              )}
            </section>

            <section className="gc-panel overflow-hidden">
              <div className="gc-panel-header">
                <div>
                  <p className="gc-eyebrow">Runtime</p>
                  <h3 className="mt-1 text-sm font-medium">Container health</h3>
                </div>
                <span className="font-mono text-[10px] text-muted"><span className="text-success">{counts.running} running</span>{counts.stopped > 0 ? ` · ${counts.stopped} stopped` : ""}</span>
              </div>
              <div className="max-h-[446px] divide-y divide-border overflow-y-auto scrollbar-thin">
                {containers.slice(0, 12).map((container) => {
                  const isStopped = container.state !== "running";
                  const isUnhealthy = container.status.includes("unhealthy");
                  return (
                    <Link
                      key={container.name}
                      href="/containers"
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/[0.025]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isStopped ? "bg-error" : isUnhealthy ? "bg-warning" : "bg-success"}`} />
                        <ContainerIcon type={getContainerType(container.name, container.image)} className="h-4 w-4 shrink-0 text-muted" />
                        <div className="min-w-0">
                          <span className="block truncate text-[12px] font-medium">{container.name}</span>
                          <span className="block truncate font-mono text-[9px] text-muted">{container.image}</span>
                        </div>
                      </div>
                      <span className={`shrink-0 font-mono text-[9px] uppercase ${isStopped ? "text-error" : isUnhealthy ? "text-warning" : "text-muted"}`}>{isStopped ? "stopped" : isUnhealthy ? "unhealthy" : container.stats?.cpu || "running"}</span>
                    </Link>
                  );
                })}
                {containers.length === 0 && (
                  <p className="p-8 text-center text-sm text-muted">No containers found</p>
                )}
              </div>
              <Link href="/containers" className="flex items-center justify-between border-t border-border px-4 py-3 text-[11px] text-muted hover:text-foreground">Open runtime <ChevronRight className="h-3.5 w-3.5" /></Link>
            </section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="gc-panel p-5">
              <p className="gc-eyebrow">Load average</p>
              <div className="mt-5 grid grid-cols-3 divide-x divide-border">
                {stats?.load.map((load, index) => (
                  <div key={index} className="px-4 first:pl-0 last:pr-0">
                    <div className="text-2xl font-medium tracking-[-0.04em]">{load.toFixed(2)}</div>
                    <div className="mt-1 font-mono text-[9px] text-muted">{index === 0 ? "1 MIN" : index === 1 ? "5 MIN" : "15 MIN"}</div>
                    <div className="mt-3 h-1 overflow-hidden bg-border">
                      <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.min((load / (stats.cpuCount || 1)) * 100, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="gc-panel overflow-hidden">
              <div className="gc-panel-header">
                <div><p className="gc-eyebrow">Attention queue</p><h3 className="mt-1 text-sm font-medium">Current signals</h3></div>
              </div>
              <div className="divide-y divide-border">
                {attentionItems.map((item) => {
                  const content = (
                    <span className="flex items-start gap-3 px-4 py-3 text-left">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.status === "critical" ? "bg-error" : item.status === "warn" ? "bg-warning" : "bg-success"}`} />
                      <span className="min-w-0"><span className="block text-[12px] font-medium">{item.label}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{item.detail}</span></span>
                    </span>
                  );
                  return item.action
                    ? <button key={item.label} type="button" onClick={item.action} className="block w-full hover:bg-white/[0.025]">{content}</button>
                    : <Link key={item.label} href={item.href || "/dashboard"} className="block hover:bg-white/[0.025]">{content}</Link>;
                })}
              </div>
              {(synthesis || synthesisError) && (
                <details className="border-t border-border px-4 py-3 text-[11px] text-muted">
                  <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-wider">Assistant analysis</summary>
                  <p className="mt-3 leading-relaxed">{synthesis?.summary || synthesisError}</p>
                </details>
              )}
            </section>
          </div>
        </div>
      )}
      <MemoryPanel open={memoryPanelOpen} onClose={() => setMemoryPanelOpen(false)} />
    </div>
  );
}
