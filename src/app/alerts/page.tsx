"use client";

import { useEffect, useState } from "react";

interface Alert {
  id: number;
  title: string;
  message: string;
  severity: string;
  source: string;
  read: boolean;
  createdAt: string;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchAlerts() {
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) setAlerts(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
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
    <div className="p-8 max-w-4xl mx-auto">
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
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`bg-card border rounded-xl p-4 transition-colors ${
                alert.read ? "border-border opacity-70" : "border-border hover:border-border-hover"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${severityColor(alert.severity)}`}>
                      {alert.severity}
                    </span>
                    <span className="text-xs text-muted font-mono">{alert.source}</span>
                    {!alert.read && <span className="w-2 h-2 rounded-full bg-accent" />}
                  </div>
                  <h3 className="text-sm font-medium">{alert.title}</h3>
                  <p className="text-xs text-muted mt-0.5">{alert.message}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-[10px] text-muted font-mono whitespace-nowrap">
                    {new Date(alert.createdAt).toLocaleString()}
                  </span>
                  {!alert.read && (
                    <button
                      onClick={() => markRead(alert.id)}
                      className="text-xs text-muted hover:text-foreground transition-colors"
                    >
                      mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
