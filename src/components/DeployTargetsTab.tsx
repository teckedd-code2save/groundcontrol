"use client";

import { useEffect, useState, useCallback } from "react";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import type { TerraformStack } from "@/components/TerraformStacksTab";

interface VpsConfig {
  id: number;
  name: string;
  host: string;
  isLocal: boolean;
}

interface DeploymentTarget {
  id: number;
  name: string;
  type: string;
  vpsConfigId: number | null;
  configJson: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  vps?: VpsConfig | null;
}

const TARGET_TYPES = [
  { value: "compose", label: "Docker Compose" },
  { value: "static", label: "Static Site" },
  { value: "k3s", label: "K3s" },
  { value: "cloudrun", label: "Cloud Run" },
  { value: "terraform", label: "Terraform Stack" },
];

const DEFAULT_CONFIG: Record<string, Record<string, unknown>> = {
  compose: {
    composeFile: "docker-compose.yml",
    projectPath: "/opt/{slug}",
    pullBeforeUp: true,
  },
  static: {
    staticRoot: "/var/www/{slug}",
    caddyTemplate: "",
  },
  k3s: {
    namespace: "gc-{slug}",
    ingressClass: "traefik",
    serviceType: "ClusterIP",
    port: 80,
  },
  cloudrun: {
    projectId: "",
    region: "us-central1",
    serviceName: "{slug}",
    cpu: 1,
    memory: "512Mi",
    concurrency: 80,
    maxInstances: 5,
  },
  terraform: {
    stackId: "",
    provisionBeforeDeploy: true,
    outputAdapter: "compose",
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeJson(res: Response): Promise<{ ok: boolean; data: any; text: string }> {
  const text = await res.text();
  try {
    const data = text ? JSON.parse(text) : {};
    return { ok: res.ok, data, text };
  } catch {
    return { ok: res.ok, data: { error: text || "Invalid response" }, text };
  }
}

function formatJson(value: string | Record<string, unknown>): string {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
}

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value || "{}");
    return true;
  } catch {
    return false;
  }
}

export function DeployTargetsTab() {
  const [targets, setTargets] = useState<DeploymentTarget[]>([]);
  const [vpsConfigs, setVpsConfigs] = useState<VpsConfig[]>([]);
  const [stacks, setStacks] = useState<TerraformStack[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeploymentTarget | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    type: "compose",
    vpsConfigId: "",
    configJson: formatJson(DEFAULT_CONFIG.compose),
    isActive: false,
  });

  const refresh = useCallback(async () => {
    const [targetsRes, vpsRes, stacksRes] = await Promise.all([
      fetch("/api/deployment-targets").then((r) => safeJson(r)),
      fetch("/api/vps").then((r) => safeJson(r)),
      fetch("/api/terraform/stacks").then((r) => safeJson(r)).catch(() => ({ ok: true, data: [], text: "" })),
    ]);
    setTargets(Array.isArray(targetsRes.data) ? targetsRes.data : []);
    setVpsConfigs(Array.isArray(vpsRes.data) ? vpsRes.data : []);
    setStacks(Array.isArray(stacksRes.data) ? stacksRes.data : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/deployment-targets").then((r) => safeJson(r)),
      fetch("/api/vps").then((r) => safeJson(r)),
      fetch("/api/terraform/stacks").then((r) => safeJson(r)).catch(() => ({ ok: true, data: [], text: "" })),
    ])
      .then(([targetsRes, vpsRes, stacksRes]) => {
        if (cancelled) return;
        setTargets(Array.isArray(targetsRes.data) ? targetsRes.data : []);
        setVpsConfigs(Array.isArray(vpsRes.data) ? vpsRes.data : []);
        setStacks(Array.isArray(stacksRes.data) ? stacksRes.data : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load targets");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm({
      name: "",
      type: "compose",
      vpsConfigId: "",
      configJson: formatJson(DEFAULT_CONFIG.compose),
      isActive: false,
    });
    setResult(null);
  }

  function startEdit(target: DeploymentTarget) {
    setEditingId(target.id);
    setForm({
      name: target.name,
      type: TARGET_TYPES.some((t) => t.value === target.type) ? target.type : "compose",
      vpsConfigId: target.vpsConfigId ? String(target.vpsConfigId) : "",
      configJson: formatJson(target.configJson),
      isActive: target.isActive,
    });
    setResult(null);
    setError("");
  }

  function handleTypeChange(type: string) {
    setForm((prev) => ({
      ...prev,
      type,
      configJson: formatJson(DEFAULT_CONFIG[type] || {}),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setError("");

    if (!form.name.trim()) {
      setResult({ success: false, message: "Target name is required" });
      return;
    }
    if (!isValidJson(form.configJson)) {
      setResult({ success: false, message: "Config JSON is invalid" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        vpsConfigId: form.vpsConfigId ? Number(form.vpsConfigId) : null,
        configJson: form.configJson,
        isActive: form.isActive,
      };

      const url = editingId ? `/api/deployment-targets/${editingId}` : "/api/deployment-targets";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { ok, data } = await safeJson(res);

      if (!ok || data.error) {
        setResult({ success: false, message: data.error || "Failed to save target" });
      } else {
        setResult({ success: true, message: editingId ? "Target updated" : "Target created" });
        await refresh();
        resetForm();
      }
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Failed to save target" });
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/deployment-targets/${deleteTarget.id}`, { method: "DELETE" });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setError(data.error || "Failed to delete target");
      } else {
        setError("");
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete target");
    } finally {
      setDeleteLoading(false);
      setDeleteTarget(null);
    }
  }

  async function setActive(id: number) {
    const target = targets.find((t) => t.id === id);
    if (!target) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/deployment-targets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, isActive: true }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setError(data.error || "Failed to activate target");
      } else {
        setError("");
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate target");
    } finally {
      setSaving(false);
    }
  }

  const needsVps = form.type === "compose" || form.type === "static" || form.type === "k3s";

  return (
    <div className="space-y-8 relative">
      <LoaderOverlay3D
        open={loading || saving || deleteLoading}
        variant="generic"
        title={deleteLoading ? "Deleting target..." : saving ? "Saving target..." : "Loading targets..."}
      />

      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:text-foreground">✕</button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">
          {editingId ? "Edit Deployment Target" : "Add Deployment Target"}
        </h2>
        <p className="text-[11px] text-muted/70 mb-6 leading-relaxed">
          Deployment targets describe where and how projects are deployed. Compose, static, and k3s targets run on the
          selected VPS; Terraform targets provision infrastructure first, then deploy through the chosen adapter.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="production-compose"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Type</label>
              <select
                value={form.type}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              >
                {TARGET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.type === "k3s" && (
            <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg text-[11px] text-muted leading-relaxed">
              <strong className="text-accent">K3s required:</strong> make sure k3s is installed on the target VPS via
              the Bootstrap tab before deploying. kubectl and helm are also recommended.
            </div>
          )}

          {form.type === "cloudrun" && (
            <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg text-[11px] text-muted leading-relaxed">
              <strong className="text-accent">GCP account required:</strong> add a GCP service account in{" "}
              <span className="font-mono text-foreground">Settings → Cloud Accounts</span> before deploying to Cloud
              Run. The active GCP account is used automatically.
            </div>
          )}

          {form.type === "terraform" && (
            <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg text-[11px] text-muted leading-relaxed">
              <strong className="text-accent">Terraform stack required:</strong> select a stack from{" "}
              <span className="font-mono text-foreground">Settings → Infrastructure</span>. The stack is applied first,
              then deployment continues using the output adapter (compose, static, etc.).
            </div>
          )}

          {form.type === "terraform" && stacks.length > 0 && (
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Terraform Stack</label>
              <select
                value={(() => {
                  try {
                    const cfg = JSON.parse(form.configJson || "{}");
                    return cfg.stackId || "";
                  } catch {
                    return "";
                  }
                })()}
                onChange={(e) => {
                  try {
                    const cfg = JSON.parse(form.configJson || "{}");
                    setForm({ ...form, configJson: formatJson({ ...cfg, stackId: e.target.value }) });
                  } catch {
                    setForm({ ...form, configJson: formatJson({ stackId: e.target.value }) });
                  }
                }}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              >
                <option value="">Select a stack</option>
                {stacks.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.provider})
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.type === "terraform" && stacks.length === 0 && (
            <div className="p-3 bg-warning/5 border border-warning/20 rounded-lg text-[11px] text-warning leading-relaxed">
              No Terraform stacks found. Create one in{" "}
              <span className="font-mono">Settings → Infrastructure</span> first.
            </div>
          )}

          {needsVps && (
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">VPS</label>
              <select
                value={form.vpsConfigId}
                onChange={(e) => setForm({ ...form, vpsConfigId: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              >
                <option value="">Active VPS (default)</option>
                {vpsConfigs.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.isLocal ? "local" : v.host})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted/60 mt-1.5">
                Leave empty to use whichever VPS is currently active.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-mono text-muted mb-1.5">Config JSON</label>
            <textarea
              value={form.configJson}
              onChange={(e) => setForm({ ...form, configJson: e.target.value })}
              rows={8}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent transition-colors"
            />
            {!isValidJson(form.configJson) && (
              <p className="text-[10px] text-error mt-1.5">Invalid JSON</p>
            )}
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-sm">Set as active default target</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {editingId ? "Update Target" : "Create Target"}
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

      {targets.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Saved Targets</h2>
          <div className="space-y-3">
            {targets.map((t) => (
              <div
                key={t.id}
                className={`flex flex-col md:flex-row md:items-center justify-between gap-3 py-3 px-4 rounded-lg border ${
                  t.isActive ? "bg-accent/5 border-accent/40" : "bg-background/50 border-transparent"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{t.name}</span>
                    <span className="text-[10px] font-mono text-muted bg-border/40 px-1.5 py-0.5 rounded">
                      {t.type}
                    </span>
                    {t.isActive && (
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
                        active
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted font-mono mt-0.5">
                    {t.type === "terraform" ? (
                      <>
                        Stack:{" "}
                        {(() => {
                          try {
                            const cfg = JSON.parse(t.configJson || "{}");
                            const stack = stacks.find((s) => String(s.id) === String(cfg.stackId));
                            return stack ? `${stack.name} (${stack.provider})` : cfg.stackId || "none";
                          } catch {
                            return "none";
                          }
                        })()}
                      </>
                    ) : (
                      <>
                        VPS: {t.vps?.name || "active VPS"}
                        {t.vps?.isLocal ? " (local)" : t.vps ? ` (${t.vps.host})` : ""}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {!t.isActive && (
                    <button
                      onClick={() => setActive(t.id)}
                      className="text-xs font-mono px-3 py-1.5 border border-accent/30 text-accent rounded-lg hover:bg-accent/10 transition-colors"
                    >
                      Set active
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(t)}
                    className="text-xs font-mono px-3 py-1.5 border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(t)}
                    className="text-xs font-mono text-error/70 hover:text-error transition-colors px-2"
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDelete
        open={!!deleteTarget}
        resourceName={deleteTarget?.name || ""}
        resourceType="Deployment Target"
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
