"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";

interface XRayTarget {
  type: "container" | "site" | "service" | "host";
  id: string;
  name: string;
  data?: any;
}

interface XRayProps {
  target: XRayTarget | null;
  onClose: () => void;
}

interface ContainerDetail {
  name: string;
  image: string;
  status: string;
  state: string;
  stats?: { cpu: string; mem: string; net: string; block: string; pids: string };
  logs: string;
}

export default function XRayPanel({ target, onClose }: XRayProps) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState("");

  useEffect(() => {
    if (!target) {
      setDetail(null);
      setLogs("");
      return;
    }
    loadDetail();
  }, [target]);

  async function loadDetail() {
    if (!target) return;
    setLoading(true);
    try {
      if (target.type === "container") {
        const [containersRes, logsRes] = await Promise.all([
          fetch("/api/containers"),
          fetch(`/api/containers/logs?name=${target.id}&tail=50`),
        ]);
        const containers = await containersRes.json();
        const container = containers.find((c: any) => c.name === target.id);
        const logsData = await logsRes.json();
        setDetail(container || null);
        setLogs(logsData.logs || "No logs");
      } else if (target.type === "site") {
        setDetail(target.data || null);
      } else if (target.type === "service") {
        setDetail(target.data || null);
      } else if (target.type === "host") {
        const res = await fetch("/api/vps/stats");
        setDetail(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: string, name?: string) {
    setActionLoading(action);
    try {
      if (action === "restart" || action === "stop" || action === "start") {
        await fetch("/api/containers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, name }),
        });
      } else if (action === "reload-caddy") {
        await fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reload", server: "caddy" }),
        });
      } else if (action === "logs" && name) {
        const res = await fetch(`/api/containers/logs?name=${name}&tail=200`);
        const data = await res.json();
        setLogs(data.logs || "No logs");
      } else if (action === "shell" && name) {
        window.open(`/terminal`, "_blank");
      }
      await loadDetail();
    } finally {
      setActionLoading(null);
    }
  }

  function getWhatsWrong(): string[] {
    if (!detail) return [];
    const issues: string[] = [];

    if (target?.type === "container") {
      if (detail.state !== "running") issues.push(`Container is ${detail.state}`);
      if (detail.status?.includes("unhealthy")) issues.push("Health checks are failing");
      if (detail.status?.includes("Restarting")) issues.push("Container is in a restart loop");
      if (detail.status?.includes("OOMKilled")) issues.push("Container was killed by out-of-memory");
      const cpu = parseFloat(detail.stats?.cpu || "0");
      if (cpu > 90) issues.push(`CPU usage is critically high (${detail.stats.cpu})`);
      const memMatch = detail.stats?.mem?.match(/(\d+\.?\d*)/);
      if (memMatch && parseFloat(memMatch[1]) > 90) issues.push(`Memory usage is critically high (${detail.stats.mem})`);
    }

    if (target?.type === "site") {
      if (!detail.domain) issues.push("No domain configured");
      if (!detail.root && !detail.proxy) issues.push("No root or proxy target configured");
    }

    if (target?.type === "host") {
      const memPct = parseFloat(detail.memory?.percent || "0");
      const diskPct = parseFloat(detail.disk?.percent || "0");
      if (memPct > 90) issues.push(`Memory usage is critically high (${memPct}%)`);
      else if (memPct > 80) issues.push(`Memory usage is elevated (${memPct}%)`);
      if (diskPct > 90) issues.push(`Disk usage is critically high (${diskPct}%)`);
      else if (diskPct > 80) issues.push(`Disk usage is elevated (${diskPct}%)`);
      const loadRatio = (detail.load?.[0] || 0) / (detail.cpuCount || 1);
      if (loadRatio > 2) issues.push(`Load average is critically high (${loadRatio.toFixed(2)}x CPU count)`);
    }

    return issues;
  }

  if (!target) return null;

  const issues = getWhatsWrong();
  const open = !!target;

  return (
    <div
      className={`fixed inset-y-0 right-0 z-[60] w-full max-w-md bg-card border-l border-border shadow-2xl transform transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div
            className={`w-3 h-3 rounded-full ${
              target.type === "container"
                ? detail?.state === "running"
                  ? detail?.status?.includes("unhealthy")
                    ? "bg-warning"
                    : "bg-success"
                  : "bg-error"
                : target.type === "host"
                ? issues.length > 0
                  ? "bg-warning"
                  : "bg-success"
                : "bg-accent"
            }`}
          />
          <div>
            <h3 className="font-medium text-sm">{target.name}</h3>
            <p className="text-[10px] text-muted font-mono uppercase">{target.type}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="overflow-auto h-[calc(100vh-4rem)] p-4 space-y-6">
        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-20 bg-border rounded-lg" />
            <div className="h-32 bg-border rounded-lg" />
          </div>
        ) : (
          <>
            {/* What's Wrong */}
            {issues.length > 0 && (
              <div className="bg-error/5 border border-error/20 rounded-lg p-3">
                <h4 className="text-xs font-mono text-error mb-2">Issues Detected</h4>
                <ul className="space-y-1">
                  {issues.map((issue, i) => (
                    <li key={i} className="text-xs text-error/80 flex items-start gap-2">
                      <span>•</span> {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Container Specific */}
            {target.type === "container" && detail && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">CPU</div>
                    <div className="text-sm font-mono font-medium">{detail.stats?.cpu || "—"}</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">Memory</div>
                    <div className="text-sm font-mono font-medium">{detail.stats?.mem || "—"}</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">PIDs</div>
                    <div className="text-sm font-mono font-medium">{detail.stats?.pids || "—"}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {detail.state === "running" ? (
                    <>
                      <button
                        onClick={() => handleAction("restart", target.id)}
                        disabled={actionLoading === "restart"}
                        className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === "restart" ? "..." : "Restart"}
                      </button>
                      <button
                        onClick={() => handleAction("stop", target.id)}
                        disabled={actionLoading === "stop"}
                        className="px-3 py-1.5 text-xs font-mono border border-error/30 text-error rounded hover:bg-error/10 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === "stop" ? "..." : "Stop"}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleAction("start", target.id)}
                      disabled={actionLoading === "start"}
                      className="px-3 py-1.5 text-xs font-mono border border-success/30 text-success rounded hover:bg-success/10 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === "start" ? "..." : "Start"}
                    </button>
                  )}
                  <button
                    onClick={() => handleAction("logs", target.id)}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                  >
                    Refresh Logs
                  </button>
                  <button
                    onClick={() => handleAction("shell", target.id)}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                  >
                    Shell
                  </button>
                </div>

                <div>
                  <h4 className="text-xs font-mono text-muted mb-2">Recent Logs</h4>
                  <pre className="bg-background/50 rounded-lg p-3 text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-64 overflow-auto scrollbar-thin">
                    {logs}
                  </pre>
                </div>
              </>
            )}

            {/* Site Specific */}
            {target.type === "site" && detail && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Domain</span>
                    <span className="font-mono text-xs"><SensitiveField value={detail.domain} /></span>
                  </div>
                  {detail.root && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Root</span>
                      <span className="font-mono text-xs"><SensitiveField value={detail.root} /></span>
                    </div>
                  )}
                  {detail.proxy && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Proxy</span>
                      <span className="font-mono text-xs"><SensitiveField value={detail.proxy} /></span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction("reload-caddy")}
                    disabled={actionLoading === "reload-caddy"}
                    className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "reload-caddy" ? "..." : "Reload Caddy"}
                  </button>
                </div>

                <div>
                  <h4 className="text-xs font-mono text-muted mb-2">Config</h4>
                  <pre className="bg-background/50 rounded-lg p-3 text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-64 overflow-auto scrollbar-thin">
                    <SensitiveField value={detail.content} />
                  </pre>
                </div>
              </>
            )}

            {/* Host Specific */}
            {target.type === "host" && detail && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">Memory</div>
                    <div className="text-sm font-mono">{detail.memory.percent}%</div>
                    <div className="text-[10px] text-muted">{detail.memory.used} / {detail.memory.total} MB</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">Disk</div>
                    <div className="text-sm font-mono">{detail.disk.percent}%</div>
                    <div className="text-[10px] text-muted">{detail.disk.used} / {detail.disk.total}</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">Load (1m)</div>
                    <div className="text-sm font-mono">{detail.load[0]?.toFixed(2)}</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">Uptime</div>
                    <div className="text-sm font-mono">{Math.floor(detail.uptime / 86400)}d</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction("prune")}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                  >
                    Prune Docker
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
