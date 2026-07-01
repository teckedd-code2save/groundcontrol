"use client";

import { useEffect, useState } from "react";

interface HealthCheckConfig {
  id: number;
  intervalSec: number;
  enabled: boolean;
  severity: string;
  lastRunAt: string | null;
  lastStatus: string | null;
}

interface HealthCheckResult {
  id: number;
  containerName: string;
  status: string;
  detail: string;
  checkedAt: string;
}

export default function HealthCheckSettingsCard() {
  const [config, setConfig] = useState<HealthCheckConfig | null>(null);
  const [results, setResults] = useState<HealthCheckResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/health-checks?limit=20");
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setResults(data.results || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveConfig(patch: Partial<HealthCheckConfig>) {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/health-checks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig(data);
        setResult({ success: true, message: "Health check settings saved" });
      } else {
        setResult({ success: false, message: data.error || "Failed to save" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/health-checks/run", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const { healthy, unhealthy, down } = data;
        setResult({
          success: true,
          message: `Checked ${healthy + unhealthy + down} container(s): ${healthy} healthy, ${unhealthy} unhealthy, ${down} down.`,
        });
        load();
      } else {
        setResult({ success: false, message: data.error || "Health check failed" });
      }
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 animate-pulse">
        <div className="h-4 bg-border rounded w-1/3 mb-4" />
        <div className="h-8 bg-border rounded mb-2" />
      </div>
    );
  }

  const severities = ["info", "warning", "error", "critical"];

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">
        Container Health Check Scheduler
      </h2>
      <p className="text-[11px] text-muted/60 mb-6 leading-relaxed">
        Periodically checks all Docker containers on the active VPS. When a container goes down
        or fails its health check, an alert is created automatically. Runs independently of the
        dashboard being open, as long as a GroundControl session is active.
      </p>

      {config && (
        <div className="space-y-4 max-w-2xl">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-40">
              <label className="block text-xs font-mono text-muted mb-1.5">Interval (seconds)</label>
              <input
                type="number"
                min={30}
                max={3600}
                value={config.intervalSec}
                onChange={(e) =>
                  setConfig({ ...config, intervalSec: Number(e.target.value) })
                }
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
              />
              <p className="text-[10px] text-muted/50 mt-1">Min 30s, max 3600s</p>
            </div>

            <div className="w-40">
              <label className="block text-xs font-mono text-muted mb-1.5">Alert Severity</label>
              <select
                value={config.severity}
                onChange={(e) =>
                  setConfig({ ...config, severity: e.target.value })
                }
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              >
                {severities.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 pb-2">
              <input
                type="checkbox"
                id="hc-enabled"
                checked={config.enabled}
                onChange={(e) =>
                  setConfig({ ...config, enabled: e.target.checked })
                }
                className="w-4 h-4 accent-accent"
              />
              <label htmlFor="hc-enabled" className="text-sm">Enabled</label>
            </div>

            <button
              onClick={() => saveConfig({
                intervalSec: config.intervalSec,
                severity: config.severity,
                enabled: config.enabled,
              })}
              disabled={saving}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>

            <button
              onClick={runNow}
              disabled={running}
              className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
            >
              {running ? "Checking..." : "Run Now"}
            </button>
          </div>

          {config.lastRunAt && (
            <div className="text-xs text-muted font-mono">
              Last run: {new Date(config.lastRunAt).toLocaleString()}
              {config.lastStatus && (
                <span className={`ml-3 ${config.lastStatus === "ok" ? "text-success" : config.lastStatus === "degraded" ? "text-warning" : "text-error"}`}>
                  ● {config.lastStatus}
                </span>
              )}
            </div>
          )}

          {result && (
            <div
              className={`p-3 rounded-lg text-sm ${
                result.success
                  ? "bg-success/10 border border-success/30 text-success"
                  : "bg-error/10 border border-error/30 text-error"
              }`}
            >
              {result.message}
            </div>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Recent Results</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {results.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-background/50 border border-border/30"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                    r.status === "healthy"
                      ? "bg-success/10 text-success border-success/20"
                      : r.status === "unhealthy"
                      ? "bg-warning/10 text-warning border-warning/20"
                      : "bg-error/10 text-error border-error/20"
                  }`}>
                    {r.status}
                  </span>
                  <span className="text-sm font-mono">{r.containerName}</span>
                </div>
                <span className="text-[10px] text-muted font-mono">
                  {new Date(r.checkedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
