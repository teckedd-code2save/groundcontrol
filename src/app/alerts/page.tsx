"use client";

import { useEffect, useState } from "react";
import { ConfirmDelete } from "@/components/ConfirmDelete";

interface Alert {
  id: number;
  title: string;
  message: string;
  severity: string;
  source: string;
  read: boolean;
  createdAt: string;
}

interface DeploymentLog {
  id: number;
  projectSlug: string;
  status: string;
  createdAt: string;
}

function getAlertAction(alert: Alert): { label: string; href: string } | null {
  const t = alert.title.toLowerCase();
  if (t.includes("deploy failed")) return { label: "View Deploy", href: "/deploy" };
  if (t.includes("memory") || t.includes("disk") || t.includes("load")) return { label: "View Dashboard", href: "/dashboard" };
  if (t.includes("unhealthy") || t.includes("container")) return { label: "View Containers", href: "/containers" };
  return null;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [deployments, setDeployments] = useState<DeploymentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<Alert | null>(null);
  const [traceAlert, setTraceAlert] = useState<Alert | null>(null);

  async function fetchAlerts() {
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) setAlerts(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function fetchDeployments() {
    try {
      const res = await fetch("/api/deploy");
      if (res.ok) setDeployments(await res.json());
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchAlerts();
    fetchDeployments();
    const interval = setInterval(() => {
      fetchAlerts();
      fetchDeployments();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  async function markRead(id: number) {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchAlerts();
  }

  async function doDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/alerts?id=${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    fetchAlerts();
  }

  async function markAllRead() {
    await Promise.all(
      alerts.filter((a) => !a.read).map((a) =>
        fetch("/api/alerts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: a.id }),
        })
      )
    );
    fetchAlerts();
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getTraceForAlert(alert: Alert) {
    const alertTime = new Date(alert.createdAt);
    const relatedDeployments = deployments.filter((d) => {
      const dTime = new Date(d.createdAt);
      const diff = Math.abs(dTime.getTime() - alertTime.getTime());
      return diff < 1000 * 60 * 30; // 30 minutes
    });

    const timeline: { time: string; label: string; type: "alert" | "deploy" | "system"; detail: string }[] = [];

    timeline.push({
      time: alert.createdAt,
      label: "Alert Triggered",
      type: "alert",
      detail: alert.message,
    });

    if (alert.source === "deploy" || alert.title.toLowerCase().includes("deploy")) {
      relatedDeployments.forEach((d) => {
        timeline.push({
          time: d.createdAt,
          label: `Deploy ${d.status === "success" ? "Succeeded" : d.status === "failed" ? "Failed" : "Started"}`,
          type: "deploy",
          detail: `Project: ${d.projectSlug}`,
        });
      });
    }

    // Sort by time descending
    timeline.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return timeline;
  }

  const severityColor = (s: string) => {
    switch (s) {
      case "critical": return "bg-error/10 text-error border-error/30";
      case "error": return "bg-error/10 text-error border-error/20";
      case "warning": return "bg-warning/10 text-warning border-warning/30";
      default: return "bg-accent/10 text-accent border-accent/20";
    }
  };

  const unread = alerts.filter((a) => !a.read).length;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alerts</h1>
          <p className="text-muted mt-1">
            {unread > 0 ? `${unread} unread alert${unread > 1 ? "s" : ""}` : "All caught up"}
          </p>
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🔕</div>
          <h3 className="text-lg font-medium mb-1">No alerts</h3>
          <p className="text-sm text-muted">Your systems are running smoothly.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const isExpanded = expanded.has(alert.id);
            const action = getAlertAction(alert);
            return (
              <div
                key={alert.id}
                className={`bg-card border rounded-xl transition-colors ${
                  alert.read ? "border-border opacity-70" : "border-border hover:border-border-hover"
                }`}
              >
                <button
                  onClick={() => toggleExpand(alert.id)}
                  className="w-full text-left p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${severityColor(alert.severity)}`}>
                          {alert.severity}
                        </span>
                        <span className="text-xs text-muted font-mono">{alert.source}</span>
                        {!alert.read && <span className="w-2 h-2 rounded-full bg-accent shrink-0" />}
                      </div>
                      <h3 className="text-sm font-medium truncate">{alert.title}</h3>
                      <p className="text-xs text-muted mt-0.5 truncate">{alert.message}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-muted font-mono whitespace-nowrap">
                        {new Date(alert.createdAt).toLocaleString()}
                      </span>
                      <span className="text-[10px] text-muted">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border/50 pt-3">
                    <p className="text-xs text-foreground/80 mb-3 whitespace-pre-wrap">{alert.message}</p>
                    <div className="flex items-center gap-2 mb-3">
                      {action && (
                        <a
                          href={action.href}
                          className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors"
                        >
                          {action.label}
                        </a>
                      )}
                      <button
                        onClick={() => setTraceAlert(alert)}
                        className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                      >
                        Trace Incident
                      </button>
                      {!alert.read && (
                        <button
                          onClick={() => markRead(alert.id)}
                          className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                        >
                          Dismiss
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteTarget(alert)}
                        className="px-3 py-1.5 text-xs font-mono border border-error/30 text-error rounded hover:bg-error/10 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDelete
        open={!!deleteTarget}
        resourceName={deleteTarget?.title || ""}
        resourceType="Alert"
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Incident Trace Modal */}
      {traceAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-medium text-sm">Incident Trace</h3>
                <p className="text-xs text-muted font-mono mt-0.5">{traceAlert.title}</p>
              </div>
              <button
                onClick={() => setTraceAlert(null)}
                className="text-muted hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 scrollbar-thin">
              <div className="relative pl-4 border-l border-border space-y-4">
                {getTraceForAlert(traceAlert).map((item, i) => (
                  <div key={i} className="relative">
                    <div
                      className={`absolute -left-[21px] top-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
                        item.type === "alert"
                          ? "bg-error"
                          : item.type === "deploy"
                          ? "bg-accent"
                          : "bg-muted"
                      }`}
                    />
                    <div className="text-[10px] text-muted font-mono">
                      {new Date(item.time).toLocaleString()}
                    </div>
                    <div className="text-xs font-medium mt-0.5">{item.label}</div>
                    <div className="text-[11px] text-muted mt-0.5">{item.detail}</div>
                  </div>
                ))}
                {getTraceForAlert(traceAlert).length === 1 && (
                  <p className="text-xs text-muted">No related events found in the last 30 minutes.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
