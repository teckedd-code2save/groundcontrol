"use client";

import { useEffect, useState } from "react";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";

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
  const [processing, setProcessing] = useState(false);

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
    const initial = setTimeout(() => {
      fetchAlerts();
      fetchDeployments();
    }, 0);
    const interval = setInterval(() => {
      fetchAlerts();
      fetchDeployments();
    }, 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  async function markRead(id: number) {
    setProcessing(true);
    try {
      await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await fetchAlerts();
    } finally {
      setProcessing(false);
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setProcessing(true);
    try {
      await fetch(`/api/alerts?id=${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await fetchAlerts();
    } finally {
      setProcessing(false);
    }
  }

  async function markAllRead() {
    setProcessing(true);
    try {
      await Promise.all(
        alerts.filter((a) => !a.read).map((a) =>
          fetch("/api/alerts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: a.id }),
          })
        )
      );
      await fetchAlerts();
    } finally {
      setProcessing(false);
    }
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
  const critical = alerts.filter((a) => !a.read && ["critical", "error"].includes(a.severity)).length;
  const warning = alerts.filter((a) => !a.read && a.severity === "warning").length;
  const groupedAlerts = [
    { label: "Needs attention", items: alerts.filter((a) => !a.read && ["critical", "error", "warning"].includes(a.severity)) },
    { label: "Info", items: alerts.filter((a) => !a.read && !["critical", "error", "warning"].includes(a.severity)) },
    { label: "Reviewed", items: alerts.filter((a) => a.read) },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="mt-1 text-xs text-muted">Incident queue, alert evidence, and next actions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-muted">
          <span className="rounded-md border border-border bg-card px-2.5 py-1.5">unread <span className="text-foreground">{unread}</span></span>
          <span className="rounded-md border border-error/20 bg-error/10 px-2.5 py-1.5 text-error">critical <span>{critical}</span></span>
          <span className="rounded-md border border-warning/20 bg-warning/10 px-2.5 py-1.5 text-warning">warning <span>{warning}</span></span>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-mono text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              Mark all read
            </button>
          )}
        </div>
      </div>

      <LoaderOverlay3D open={loading || processing} variant="generic" title={loading ? "Loading alerts..." : "Updating alerts..."} />

      {loading ? null : alerts.length === 0 ? (
        <div className="bg-card rounded-xl p-12 text-center">
          <h3 className="text-lg font-medium mb-1">No alerts</h3>
          <p className="text-sm text-muted">Your systems are running smoothly.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedAlerts.map((group) => (
            <section key={group.label} className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{group.label}</h2>
                <span className="rounded bg-card px-2 py-1 text-[10px] font-mono text-muted">{group.items.length}</span>
              </div>
              {group.items.map((alert) => {
                const isExpanded = expanded.has(alert.id);
                const action = getAlertAction(alert);
                return (
                  <div
                    key={alert.id}
                    className={`bg-card rounded-xl transition-colors hover:bg-card/80 ${alert.read ? "opacity-60" : ""}`}
                  >
                    <button onClick={() => toggleExpand(alert.id)} className="w-full p-4 text-left">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${severityColor(alert.severity)}`}>
                              {alert.severity}
                            </span>
                            <span className="text-xs text-muted font-mono">{alert.source}</span>
                            {!alert.read && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                          </div>
                          <h3 className="truncate text-sm font-medium">{alert.title}</h3>
                          <p className="mt-0.5 truncate text-xs text-muted">{alert.message}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="whitespace-nowrap text-[10px] font-mono text-muted">
                            {new Date(alert.createdAt).toLocaleString()}
                          </span>
                          <span className="text-[10px] text-muted">{isExpanded ? "▲" : "▼"}</span>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1">
                        <p className="mb-3 whitespace-pre-wrap text-xs text-foreground/80">{alert.message}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {action && (
                            <a
                              href={action.href}
                              className="rounded bg-accent/10 px-3 py-1.5 text-xs font-mono text-accent transition-colors hover:bg-accent/20"
                            >
                              {action.label}
                            </a>
                          )}
                          <button
                            onClick={() => setTraceAlert(alert)}
                            className="rounded bg-background px-3 py-1.5 text-xs font-mono text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                          >
                            Trace
                          </button>
                          {!alert.read && (
                            <button
                              onClick={() => markRead(alert.id)}
                              className="rounded bg-background px-3 py-1.5 text-xs font-mono text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                            >
                              Dismiss
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget(alert)}
                            className="rounded bg-error/10 px-3 py-1.5 text-xs font-mono text-error transition-colors hover:bg-error/20"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
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
