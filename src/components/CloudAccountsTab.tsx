"use client";

import { useEffect, useState } from "react";
import { ConfirmDelete } from "@/components/ConfirmDelete";

interface CloudProviderAccount {
  id: number;
  name: string;
  provider: string;
  credentials: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const PROVIDERS = [
  { value: "gcp", label: "Google Cloud (GCP)" },
  { value: "aws", label: "Amazon Web Services (AWS)" },
  { value: "azure", label: "Microsoft Azure" },
];

function maskCredential(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return "•".repeat(value.length - 4) + value.slice(-4);
}

function parseCredentials(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
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

export default function CloudAccountsTab() {
  const [accounts, setAccounts] = useState<CloudProviderAccount[]>([]);
  const [form, setForm] = useState({
    name: "",
    provider: "gcp",
    credentials: "{}",
    isActive: false,
  });
  const [editing, setEditing] = useState<CloudProviderAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CloudProviderAccount | null>(null);

  async function loadAccounts() {
    setLoading(true);
    try {
      const res = await fetch("/api/cloud-accounts");
      if (res.ok) setAccounts(await res.json());
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cloud-accounts")
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) setAccounts(await res.json());
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setForm({ name: "", provider: "gcp", credentials: "{}", isActive: false });
    setEditing(null);
    setResult(null);
  }

  function startEdit(account: CloudProviderAccount) {
    setEditing(account);
    setForm({
      name: account.name,
      provider: account.provider,
      credentials: "",
      isActive: account.isActive,
    });
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setResult({ success: false, message: "Account name is required" });
      return;
    }
    if (!isValidJson(form.credentials)) {
      setResult({ success: false, message: "Credentials JSON is invalid" });
      return;
    }

    setSaving(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        provider: form.provider,
        isActive: accounts.length === 0 ? true : form.isActive,
      };
      if (!editing || form.credentials.trim()) {
        payload.credentials = parseCredentials(form.credentials);
      }
      const url = editing ? `/api/cloud-accounts/${editing.id}` : "/api/cloud-accounts";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        resetForm();
        await loadAccounts();
        setResult({ success: true, message: editing ? "Account updated" : "Account saved" });
      } else {
        setResult({ success: false, message: data.error || "Failed to save account" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function activate(id: number) {
    try {
      const res = await fetch(`/api/cloud-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      if (res.ok) await loadAccounts();
    } catch {
      // ignore
    }
  }

  async function testAccount(id: number) {
    setTesting(id);
    setResult(null);
    try {
      const res = await fetch(`/api/cloud-accounts/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ success: true, message: data.message || "Credentials valid" });
      } else {
        setResult({ success: false, message: data.error || data.message || "Credentials invalid" });
      }
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/cloud-accounts/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        await loadAccounts();
        setResult({ success: true, message: "Account deleted" });
      } else {
        const data = await res.json().catch(() => ({}));
        setResult({ success: false, message: data.error || "Failed to delete account" });
      }
    } catch {
      setResult({ success: false, message: "Failed to delete account" });
    }
    setDeleteTarget(null);
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 animate-pulse">
        <div className="h-4 bg-border rounded w-1/3 mb-4" />
        <div className="h-8 bg-border rounded mb-2" />
        <div className="h-8 bg-border rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">Cloud Provider Account</h2>
        <p className="text-[11px] text-muted/70 mb-6 leading-relaxed">
          Add service-account credentials for managed serverless targets. Credentials are encrypted at rest. Only the
          active account for each provider is used during deployment.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="production-gcp"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Provider</label>
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-muted mb-1.5">Credentials JSON</label>
            <textarea
              value={form.credentials}
              onChange={(e) => setForm({ ...form, credentials: e.target.value })}
              rows={8}
              placeholder={form.provider === "gcp" ? '{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "...",\n  "client_email": "..."\n}' : "{}"}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent transition-colors"
            />
            {!isValidJson(form.credentials) && (
              <p className="text-[10px] text-error mt-1.5">Invalid JSON</p>
            )}
            {form.provider === "gcp" && (
              <p className="text-[10px] text-muted/60 mt-1.5">
                For GCP, paste the downloaded service-account JSON. {editing && "Leave blank to keep existing credentials."}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="cloud-active"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
            <label htmlFor="cloud-active" className="text-sm">
              Set as active {PROVIDERS.find((p) => p.value === form.provider)?.label} account
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : editing ? "Update Account" : "Add Account"}
            </button>
            {editing && (
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

      {accounts.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Saved Accounts</h2>
          <div className="space-y-3">
            {accounts.map((account) => {
              const masked = maskCredential(account.credentials);
              return (
                <div
                  key={account.id}
                  className={`flex flex-col md:flex-row md:items-center justify-between gap-3 py-3 px-4 rounded-lg border ${
                    account.isActive ? "bg-accent/5 border-accent/40" : "bg-background/50 border-transparent"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                      {account.name}
                      <span className="text-[10px] font-mono text-muted bg-border/40 px-1.5 py-0.5 rounded">
                        {account.provider}
                      </span>
                      {account.isActive && (
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
                          active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted font-mono mt-0.5">credentials: {masked}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => testAccount(account.id)}
                      disabled={testing === account.id}
                      className="text-xs font-mono text-muted hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {testing === account.id ? "testing..." : "test credentials"}
                    </button>
                    {!account.isActive && (
                      <button
                        onClick={() => activate(account.id)}
                        className="text-xs font-mono px-3 py-1.5 border border-accent/30 text-accent rounded-lg hover:bg-accent/10 transition-colors"
                      >
                        activate
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(account)}
                      className="text-xs font-mono text-muted hover:text-foreground transition-colors"
                    >
                      edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(account)}
                      className="text-xs font-mono text-error/70 hover:text-error transition-colors"
                    >
                      remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <ConfirmDelete
            open={!!deleteTarget}
            resourceName={deleteTarget?.name || ""}
            resourceType="Cloud Provider Account"
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        </div>
      )}
    </div>
  );
}
