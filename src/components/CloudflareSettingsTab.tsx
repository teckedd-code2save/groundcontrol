"use client";

import { useEffect, useState } from "react";
import { ConfirmDelete } from "@/components/ConfirmDelete";

interface CloudflareAccount {
  id: number;
  name: string;
  apiToken: string;
  accountId: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function CloudflareSettingsTab() {
  const [accounts, setAccounts] = useState<CloudflareAccount[]>([]);
  const [form, setForm] = useState({
    name: "",
    apiToken: "",
    accountId: "",
    email: "",
    isActive: false,
  });
  const [editing, setEditing] = useState<CloudflareAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CloudflareAccount | null>(null);

  async function loadAccounts() {
    try {
      const res = await fetch("/api/cloudflare/accounts");
      if (res.ok) setAccounts(await res.json());
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      await loadAccounts();
    }
    init();
  }, []);

  function resetForm() {
    setForm({ name: "", apiToken: "", accountId: "", email: "", isActive: false });
    setEditing(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      const payload = {
        ...form,
        isActive: accounts.length === 0 ? true : form.isActive,
      };
      const res = await fetch("/api/cloudflare/accounts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...payload } : payload),
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
      const res = await fetch("/api/cloudflare/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive: true }),
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
      const res = await fetch("/api/cloudflare/accounts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ success: true, message: `Token valid${data.result?.status ? ` (${data.result.status})` : ""}` });
      } else {
        setResult({ success: false, message: data.error || (data.errors || []).map((e: { message?: string }) => e.message).join("; ") || "Token invalid" });
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
      const res = await fetch(`/api/cloudflare/accounts?id=${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        await loadAccounts();
        setResult({ success: true, message: "Account deleted" });
      }
    } catch {
      setResult({ success: false, message: "Failed to delete account" });
    }
    setDeleteTarget(null);
  }

  function startEdit(account: CloudflareAccount) {
    setEditing(account);
    setForm({
      name: account.name,
      apiToken: "",
      accountId: account.accountId || "",
      email: account.email || "",
      isActive: account.isActive,
    });
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
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">Cloudflare Account</h2>
        <p className="text-[11px] text-muted/70 mb-6 leading-relaxed">
          Add a Cloudflare API token with permissions for Cloudflare Tunnel and DNS. The token is encrypted at rest.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              required
            />
            <input
              type="text"
              placeholder="Account ID"
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <input
              type="password"
              placeholder={editing ? "API token (leave blank to keep existing)" : "API token"}
              value={form.apiToken}
              onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              required={!editing}
            />
            <input
              type="email"
              placeholder="Email (optional)"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="cf-active"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
            <label htmlFor="cf-active" className="text-sm">Set as active account</label>
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
        </form>
      </div>

      {accounts.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Saved Accounts</h2>
          <div className="space-y-3">
            {accounts.map((account) => (
              <div
                key={account.id}
                className={`flex items-center justify-between py-3 px-4 rounded-lg border ${
                  account.isActive ? "bg-accent/5 border-accent/40" : "bg-background/50 border-transparent"
                }`}
              >
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {account.name}
                    {account.isActive && (
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
                        active
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted font-mono mt-0.5">
                    {account.accountId || "no account id"} · {account.email || "no email"} · token {account.apiToken ? "set" : "missing"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => testAccount(account.id)}
                    disabled={testing === account.id}
                    className="text-xs font-mono text-muted hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {testing === account.id ? "testing..." : "test token"}
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
            ))}
          </div>
          <ConfirmDelete
            open={!!deleteTarget}
            resourceName={deleteTarget?.name || ""}
            resourceType="Cloudflare Account"
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
          />
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

      {/* DNS Records panel — shown when an active account exists */}
      <DnsRecordsPanel />
    </div>
  );
}

function DnsRecordsPanel() {
  const [zones, setZones] = useState<{ id: string; name: string; status: string }[]>([]);
  const [selectedZone, setSelectedZone] = useState<string>("");
  const [records, setRecords] = useState<{ id: string; type: string; name: string; content: string; ttl: number; proxied: boolean }[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [zoneError, setZoneError] = useState("");
  const [newRecord, setNewRecord] = useState({ type: "A", name: "", content: "", ttl: 1, proxied: true });
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    loadZones();
  }, []);

  async function loadZones() {
    setLoadingZones(true); setZoneError("");
    try {
      const res = await fetch("/api/cloudflare/zones");
      const data = await res.json();
      if (res.ok && data.zones) {
        setZones(data.zones);
        if (data.zones.length > 0 && !selectedZone) setSelectedZone(data.zones[0].id);
      } else {
        setZoneError(data.error || "Failed to load zones. Is Cloudflare configured?");
      }
    } catch { setZoneError("Failed to load zones"); }
    finally { setLoadingZones(false); }
  }

  useEffect(() => {
    if (!selectedZone) return;
    loadRecords(selectedZone);
  }, [selectedZone]);

  async function loadRecords(zoneId: string) {
    setLoadingRecords(true);
    try {
      const res = await fetch(`/api/cloudflare/zones/${zoneId}/dns`);
      const data = await res.json();
      if (res.ok && data.records) setRecords(data.records);
      else setRecords([]);
    } catch { setRecords([]); }
    finally { setLoadingRecords(false); }
  }

  async function handleAddRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedZone || !newRecord.name || !newRecord.content) return;
    setAdding(true); setAddResult(null);
    try {
      const res = await fetch(`/api/cloudflare/zones/${selectedZone}/dns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRecord),
      });
      const data = await res.json();
      if (res.ok) {
        setAddResult({ ok: true, msg: `Record ${newRecord.name} created` });
        setNewRecord({ type: "A", name: "", content: "", ttl: 1, proxied: true });
        await loadRecords(selectedZone);
      } else {
        setAddResult({ ok: false, msg: data.error || "Failed" });
      }
    } catch { setAddResult({ ok: false, msg: "Network error" }); }
    finally { setAdding(false); }
  }

  async function handleDelete(recordId: string) {
    if (!selectedZone) return;
    setDeleting(recordId);
    try {
      await fetch(`/api/cloudflare/zones/${selectedZone}/dns/${recordId}`, { method: "DELETE" });
      await loadRecords(selectedZone);
    } catch {} finally { setDeleting(null); }
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">DNS Records</h2>
        
        {loadingZones && <p className="text-xs text-muted font-mono">Loading zones...</p>}
        {zoneError && <p className="text-xs text-muted font-mono">{zoneError}</p>}

        {zones.length > 0 && (
          <>
            <div className="mb-4">
              <label className="block text-xs font-mono text-muted mb-1.5">Zone</label>
              <select value={selectedZone} onChange={e => setSelectedZone(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent">
                {zones.map(z => <option key={z.id} value={z.id}>{z.name} ({z.status})</option>)}
              </select>
            </div>

            {/* Add record form */}
            <form onSubmit={handleAddRecord} className="mb-4 p-4 bg-background/50 rounded-lg border border-border">
              <p className="text-xs font-mono text-muted mb-3">Add Record</p>
              <div className="flex flex-wrap gap-2 items-end">
                <select value={newRecord.type} onChange={e => setNewRecord({...newRecord, type: e.target.value})}
                  className="bg-card border border-border rounded px-2 py-1.5 text-xs font-mono outline-none">
                  {["A","CNAME","MX","TXT","AAAA"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="text" placeholder="name (@ for root)" value={newRecord.name} onChange={e => setNewRecord({...newRecord, name: e.target.value})}
                  className="bg-card border border-border rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-accent w-40"/>
                <input type="text" placeholder="content" value={newRecord.content} onChange={e => setNewRecord({...newRecord, content: e.target.value})}
                  className="bg-card border border-border rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-accent flex-1 min-w-[120px]"/>
                <label className="flex items-center gap-1 text-[10px] text-muted font-mono">
                  <input type="checkbox" checked={newRecord.proxied} onChange={e => setNewRecord({...newRecord, proxied: e.target.checked})} className="accent-accent"/> Proxy
                </label>
                <button type="submit" disabled={adding}
                  className="px-3 py-1.5 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20 disabled:opacity-50">
                  {adding ? "..." : "Add"}
                </button>
              </div>
              {addResult && (
                <p className={`text-[10px] mt-2 font-mono ${addResult.ok ? "text-success" : "text-error"}`}>{addResult.msg}</p>
              )}
            </form>

            {/* Records table */}
            {loadingRecords && <p className="text-xs text-muted font-mono">Loading records...</p>}
            {!loadingRecords && records.length === 0 && (
              <p className="text-xs text-muted font-mono">No DNS records found for this zone.</p>
            )}
            {records.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th className="text-left py-2 px-2">Type</th>
                      <th className="text-left py-2 px-2">Name</th>
                      <th className="text-left py-2 px-2">Content</th>
                      <th className="text-left py-2 px-2">TTL</th>
                      <th className="text-left py-2 px-2">Proxy</th>
                      <th className="text-right py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(r => (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-background/50">
                        <td className="py-1.5 px-2"><span className="px-1 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 text-[10px]">{r.type}</span></td>
                        <td className="py-1.5 px-2">{r.name}</td>
                        <td className="py-1.5 px-2 truncate max-w-[200px]">{r.content}</td>
                        <td className="py-1.5 px-2 text-muted">{r.ttl === 1 ? "Auto" : r.ttl}</td>
                        <td className="py-1.5 px-2">{r.proxied ? "🟠" : "⚪"}</td>
                        <td className="py-1.5 px-2 text-right">
                          <button onClick={() => handleDelete(r.id)} disabled={deleting === r.id}
                            className="text-[10px] text-error/70 hover:text-error font-mono disabled:opacity-50">
                            {deleting === r.id ? "..." : "del"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
