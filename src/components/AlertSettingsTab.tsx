"use client";

import { useEffect, useState } from "react";
import { ConfirmDelete } from "@/components/ConfirmDelete";

interface AlertRule {
  id: number;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  durationSec: number;
  severity: string;
  enabled: boolean;
}

interface AlertSettings {
  id: number;
  retentionDays: number;
}

export default function AlertSettingsTab() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Partial<AlertRule>>({
    name: "",
    metric: "cpu_load_1",
    operator: ">",
    threshold: 0,
    durationSec: 60,
    severity: "warning",
    enabled: true,
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AlertRule | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  async function load() {
    try {
      const [rulesRes, settingsRes] = await Promise.all([
        fetch("/api/alert-rules"),
        fetch("/api/alert-settings"),
      ]);
      if (rulesRes.ok) setRules(await rulesRes.json());
      if (settingsRes.ok) setSettings(await settingsRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setForm({
      name: "",
      metric: "cpu_load_1",
      operator: ">",
      threshold: 0,
      durationSec: 60,
      severity: "warning",
      enabled: true,
    });
    setEditingId(null);
  }

  function startEdit(rule: AlertRule) {
    setForm({ ...rule });
    setEditingId(rule.id);
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    const payload = {
      id: editingId || undefined,
      ...form,
      threshold: Number(form.threshold),
      durationSec: Number(form.durationSec),
    };

    const res = await fetch("/api/alert-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      setResult({ success: true, message: editingId ? "Rule updated" : "Rule created" });
      resetForm();
      load();
    } else {
      setResult({ success: false, message: data.error || "Failed to save rule" });
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/alert-rules?id=${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    load();
  }

  async function saveRetention() {
    setResult(null);
    const res = await fetch("/api/alert-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retentionDays: settings?.retentionDays || 30 }),
    });
    const data = await res.json();
    if (res.ok) {
      setSettings(data);
      setResult({ success: true, message: "Retention setting saved" });
    } else {
      setResult({ success: false, message: data.error || "Failed to save retention" });
    }
  }

  async function evaluateNow() {
    setEvaluating(true);
    setResult(null);
    try {
      const res = await fetch("/api/alert-rules/evaluate", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResult({
          success: true,
          message: `Evaluation complete. Created ${data.created?.length || 0} alert(s), pruned ${data.deleted || 0} old alert(s).`,
        });
        load();
      } else {
        setResult({ success: false, message: data.error || "Evaluation failed" });
      }
    } finally {
      setEvaluating(false);
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

  const metrics = [
    { key: "cpu_load_1", label: "CPU load (1 min)" },
    { key: "mem_percent", label: "Memory percent" },
    { key: "disk_percent", label: "Disk percent" },
    { key: "unhealthy_containers", label: "Unhealthy containers" },
    { key: "container_down", label: "Containers down" },
  ];

  const operators = [">", "<", "==", ">=", "<="];
  const severities = ["info", "warning", "error", "critical"];

  return (
    <div className="space-y-8">
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">Alert Rules</h2>
        <p className="text-[11px] text-muted/60 mb-6 leading-relaxed">
          Rules evaluate against the latest metric snapshots. A rule must breach for the configured
          duration (looked up as consecutive snapshots) before an alert is created.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={form.name || ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="High CPU"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Metric</label>
              <select
                value={form.metric}
                onChange={(e) => setForm({ ...form, metric: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              >
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <div className="w-24">
                <label className="block text-xs font-mono text-muted mb-1.5">Operator</label>
                <select
                  value={form.operator}
                  onChange={(e) => setForm({ ...form, operator: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
                >
                  {operators.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-mono text-muted mb-1.5">Threshold</label>
                <input
                  type="number"
                  step="any"
                  value={form.threshold}
                  onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Duration (seconds)</label>
              <input
                type="number"
                min={0}
                value={form.durationSec}
                onChange={(e) => setForm({ ...form, durationSec: Number(e.target.value) })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Severity</label>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              >
                {severities.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3 md:col-span-2">
              <input
                type="checkbox"
                id="enabled"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="w-4 h-4 accent-accent"
              />
              <label htmlFor="enabled" className="text-sm">Enabled</label>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={!form.name}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {editingId ? "Update Rule" : "Add Rule"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
              >
                Cancel
              </button>
            )}
          </div>

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
        </form>
      </div>

      {rules.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Saved Rules</h2>
          <div className="space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center justify-between py-3 px-4 rounded-lg border ${
                  rule.enabled ? "bg-background/50 border-transparent" : "bg-muted/5 border-border/30 opacity-60"
                }`}
              >
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {rule.name}
                    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                      rule.severity === "critical"
                        ? "bg-error/15 text-error border-error/30"
                        : rule.severity === "error"
                        ? "bg-warning/15 text-warning border-warning/30"
                        : rule.severity === "warning"
                        ? "bg-accent/15 text-accent border-accent/30"
                        : "bg-success/15 text-success border-success/30"
                    }`}>
                      {rule.severity}
                    </span>
                  </div>
                  <div className="text-xs text-muted font-mono mt-0.5">
                    {rule.metric} {rule.operator} {rule.threshold} for {rule.durationSec}s
                    {rule.enabled ? "" : " · disabled"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => startEdit(rule)}
                    className="text-xs font-mono px-3 py-1.5 border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(rule)}
                    className="text-xs font-mono text-error/70 hover:text-error transition-colors"
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Retention & Evaluation</h2>
        <div className="flex flex-wrap items-end gap-4 max-w-md mb-4">
          <div className="w-32">
            <label className="block text-xs font-mono text-muted mb-1.5">Retention (days)</label>
            <input
              type="number"
              min={1}
              value={settings?.retentionDays || 30}
              onChange={(e) =>
                setSettings((prev) => (prev ? { ...prev, retentionDays: Number(e.target.value) } : prev))
              }
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
            />
          </div>
          <button
            onClick={saveRetention}
            className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
          >
            Save Retention
          </button>
        </div>
        <button
          onClick={evaluateNow}
          disabled={evaluating}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {evaluating ? "Evaluating..." : "Evaluate Now"}
        </button>
      </div>

      <ConfirmDelete
        open={!!deleteTarget}
        resourceName={deleteTarget?.name || ""}
        resourceType="Alert Rule"
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
