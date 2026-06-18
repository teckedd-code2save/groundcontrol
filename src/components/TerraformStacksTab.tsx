"use client";

import { useEffect, useState, useCallback } from "react";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { ConfirmDelete } from "@/components/ConfirmDelete";

export type TerraformProvider = "hetzner" | "aws" | "gcp" | "azure";
export type StateBackend = "local" | "s3" | "gcs";

export interface TerraformStack {
  id: number;
  name: string;
  provider: TerraformProvider;
  workspace: string;
  hcl: string;
  varsJson: string;
  stateBackend: StateBackend;
  statePath: string | null;
  lastPlan: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TerraformOutput {
  value: unknown;
  type: string;
  sensitive?: boolean;
}

export interface PlanResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface ApplyResult {
  success: boolean;
  outputs?: Record<string, TerraformOutput>;
  error?: string;
}

const PROVIDERS: { value: TerraformProvider; label: string }[] = [
  { value: "hetzner", label: "Hetzner Cloud" },
  { value: "aws", label: "AWS" },
  { value: "gcp", label: "GCP" },
  { value: "azure", label: "Azure" },
];

const BACKENDS: { value: StateBackend; label: string }[] = [
  { value: "local", label: "Local (on VPS)" },
  { value: "s3", label: "S3-compatible" },
  { value: "gcs", label: "GCS" },
];

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

const DEFAULT_HCL = `terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

variable "hcloud_token" {
  sensitive = true
}

provider "hcloud" {
  token = var.hcloud_token
}
`;

export default function TerraformStacksTab() {
  const [stacks, setStacks] = useState<TerraformStack[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionTitle, setActionTitle] = useState("Working...");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TerraformStack | null>(null);
  const [outputs, setOutputs] = useState<Record<number, Record<string, TerraformOutput>>>({});
  const [planOutputs, setPlanOutputs] = useState<Record<number, string>>({});

  const [form, setForm] = useState({
    name: "",
    provider: "hetzner" as TerraformProvider,
    workspace: "default",
    stateBackend: "local" as StateBackend,
    varsJson: "{}",
    hcl: DEFAULT_HCL,
  });

  const refresh = useCallback(async () => {
    const res = await fetch("/api/terraform/stacks");
    const { ok, data } = await safeJson(res);
    setStacks(Array.isArray(data) ? data : []);
    if (!ok) setError(data.error || "Failed to load stacks");
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/terraform/stacks")
      .then((r) => safeJson(r))
      .then(({ ok, data }) => {
        if (cancelled) return;
        setStacks(Array.isArray(data) ? data : []);
        if (!ok) setError(data.error || "Failed to load stacks");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load stacks");
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
      provider: "hetzner",
      workspace: "default",
      stateBackend: "local",
      varsJson: "{}",
      hcl: DEFAULT_HCL,
    });
    setResult(null);
  }

  function startEdit(stack: TerraformStack) {
    setEditingId(stack.id);
    setForm({
      name: stack.name,
      provider: stack.provider,
      workspace: stack.workspace,
      stateBackend: stack.stateBackend,
      varsJson: formatJson(stack.varsJson),
      hcl: stack.hcl,
    });
    setResult(null);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setError("");

    if (!form.name.trim()) {
      setResult({ success: false, message: "Stack name is required" });
      return;
    }
    if (!isValidJson(form.varsJson)) {
      setResult({ success: false, message: "Variables JSON is invalid" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        provider: form.provider,
        workspace: form.workspace.trim() || "default",
        stateBackend: form.stateBackend,
        varsJson: form.varsJson,
        hcl: form.hcl,
      };
      const url = editingId ? `/api/terraform/stacks/${editingId}` : "/api/terraform/stacks";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setResult({ success: false, message: data.error || "Failed to save stack" });
      } else {
        setResult({ success: true, message: editingId ? "Stack updated" : "Stack created" });
        await refresh();
        resetForm();
      }
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Failed to save stack" });
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setActionLoading(true);
    setActionTitle("Deleting stack...");
    try {
      const res = await fetch(`/api/terraform/stacks/${deleteTarget.id}`, { method: "DELETE" });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setError(data.error || "Failed to delete stack");
      } else {
        setError("");
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete stack");
    } finally {
      setActionLoading(false);
      setDeleteTarget(null);
    }
  }

  async function runAction(
    stack: TerraformStack,
    action: "plan" | "apply" | "destroy" | "outputs" | "generate"
  ) {
    setActionLoading(true);
    setActionTitle(
      action === "plan"
        ? "Running terraform plan..."
        : action === "apply"
          ? "Running terraform apply..."
          : action === "destroy"
            ? "Running terraform destroy..."
            : action === "outputs"
              ? "Reading outputs..."
              : "Generating HCL..."
    );
    setResult(null);
    try {
      let res: Response;
      if (action === "generate") {
        res = await fetch(`/api/terraform/stacks/${stack.id}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: stack.provider, name: stack.name }),
        });
      } else if (action === "outputs") {
        res = await fetch(`/api/terraform/stacks/${stack.id}/outputs`);
      } else {
        res = await fetch(`/api/terraform/stacks/${stack.id}/${action}`, { method: "POST" });
      }
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setResult({ success: false, message: data.error || `Failed to ${action} stack` });
      } else {
        if (action === "plan") {
          setPlanOutputs((prev) => ({ ...prev, [stack.id]: data.output || data.plan || "Plan completed" }));
          setResult({ success: true, message: "Plan completed" });
        } else if (action === "apply") {
          setOutputs((prev) => ({ ...prev, [stack.id]: data.outputs || {} }));
          setResult({ success: true, message: "Apply completed" });
        } else if (action === "destroy") {
          setResult({ success: true, message: "Destroy completed" });
        } else if (action === "outputs") {
          setOutputs((prev) => ({ ...prev, [stack.id]: data.outputs || {} }));
          setResult({ success: true, message: "Outputs refreshed" });
        } else if (action === "generate") {
          setForm((prev) => ({ ...prev, hcl: data.hcl || prev.hcl }));
          setResult({ success: true, message: "HCL regenerated" });
        }
        await refresh();
      }
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : `Failed to ${action} stack` });
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-8 relative">
      <LoaderOverlay3D
        open={loading || saving || actionLoading}
        variant="generic"
        title={actionLoading ? actionTitle : saving ? "Saving stack..." : "Loading stacks..."}
      />

      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:text-foreground">
            ✕
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">
          {editingId ? "Edit Terraform Stack" : "Add Terraform Stack"}
        </h2>
        <p className="text-[11px] text-muted/70 mb-6 leading-relaxed">
          Terraform stacks describe cloud infrastructure. Variables are encrypted at rest. Plans and applies run on the
          active VPS (local backend) or against the configured remote backend.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="production-vps"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Provider</label>
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value as TerraformProvider })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Workspace</label>
              <input
                type="text"
                value={form.workspace}
                onChange={(e) => setForm({ ...form, workspace: e.target.value })}
                placeholder="default"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">State Backend</label>
              <select
                value={form.stateBackend}
                onChange={(e) => setForm({ ...form, stateBackend: e.target.value as StateBackend })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              >
                {BACKENDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-muted mb-1.5">Variables JSON</label>
            <textarea
              value={form.varsJson}
              onChange={(e) => setForm({ ...form, varsJson: e.target.value })}
              rows={5}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent transition-colors"
            />
            {!isValidJson(form.varsJson) && <p className="text-[10px] text-error mt-1.5">Invalid JSON</p>}
          </div>

          <div>
            <label className="block text-xs font-mono text-muted mb-1.5">HCL Editor</label>
            <textarea
              value={form.hcl}
              onChange={(e) => setForm({ ...form, hcl: e.target.value })}
              rows={14}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {editingId ? "Update Stack" : "Create Stack"}
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

      {stacks.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-6">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted">Saved Stacks</h2>
          <div className="space-y-4">
            {stacks.map((stack) => (
              <div
                key={stack.id}
                className="bg-background/50 border border-border rounded-xl p-4 space-y-4"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{stack.name}</span>
                      <span className="text-[10px] font-mono text-muted bg-border/40 px-1.5 py-0.5 rounded">
                        {stack.provider}
                      </span>
                      <span className="text-[10px] font-mono text-muted bg-border/40 px-1.5 py-0.5 rounded">
                        {stack.workspace}
                      </span>
                      <span className="text-[10px] font-mono text-muted bg-border/40 px-1.5 py-0.5 rounded">
                        {stack.stateBackend}
                      </span>
                    </div>
                    {stack.statePath && (
                      <div className="text-[10px] text-muted font-mono mt-0.5">state: {stack.statePath}</div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      onClick={() => runAction(stack, "generate")}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-[10px] font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                    >
                      Generate HCL
                    </button>
                    <button
                      onClick={() => runAction(stack, "plan")}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-[10px] font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                    >
                      Plan
                    </button>
                    <button
                      onClick={() => runAction(stack, "apply")}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-[10px] font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => runAction(stack, "destroy")}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-[10px] font-mono bg-error/10 border border-error/30 text-error rounded-lg hover:bg-error/20 transition-colors disabled:opacity-50"
                    >
                      Destroy
                    </button>
                    <button
                      onClick={() => runAction(stack, "outputs")}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-[10px] font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                    >
                      Outputs
                    </button>
                    <button
                      onClick={() => startEdit(stack)}
                      className="px-3 py-1.5 text-[10px] font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(stack)}
                      className="text-[10px] font-mono text-error/70 hover:text-error transition-colors px-2"
                    >
                      remove
                    </button>
                  </div>
                </div>

                {planOutputs[stack.id] && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted">Last Plan</div>
                    <pre className="text-[10px] font-mono text-foreground/80 bg-background border border-border rounded p-3 max-h-60 overflow-auto whitespace-pre-wrap">
                      {planOutputs[stack.id]}
                    </pre>
                  </div>
                )}

                {stack.lastPlan && !planOutputs[stack.id] && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted">Stored Plan</div>
                    <pre className="text-[10px] font-mono text-foreground/80 bg-background border border-border rounded p-3 max-h-60 overflow-auto whitespace-pre-wrap">
                      {stack.lastPlan}
                    </pre>
                  </div>
                )}

                {outputs[stack.id] && Object.keys(outputs[stack.id]).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted">Outputs</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {Object.entries(outputs[stack.id]).map(([key, out]) => (
                        <div
                          key={key}
                          className="bg-background border border-border rounded-lg p-2.5"
                        >
                          <div className="text-[10px] font-mono text-accent truncate">{key}</div>
                          <div className="text-xs font-mono text-foreground truncate">
                            {String(out.value)}
                          </div>
                          {out.sensitive && (
                            <span className="text-[9px] font-mono text-warning">sensitive</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDelete
        open={!!deleteTarget}
        resourceName={deleteTarget?.name || ""}
        resourceType="Terraform Stack"
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
