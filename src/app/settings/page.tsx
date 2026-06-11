"use client";

import { useEffect, useState } from "react";
import { SensitiveField, SensitiveInput } from "@/components/SensitiveField";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import VpsFilePicker from "@/components/VpsFilePicker";

interface VpsConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  isLocal: boolean;
  isActive: boolean;
  hasKey: boolean;
  hasPassword: boolean;
  createdAt: string;
}

export default function SettingsPage() {
  const [configs, setConfigs] = useState<VpsConfig[]>([]);
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: 22,
    username: "",
    privateKey: "",
    password: "",
    authType: "key",
    isLocal: false,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deleteConfigTarget, setDeleteConfigTarget] = useState<VpsConfig | null>(null);

  async function fetchConfigs() {
    const res = await fetch("/api/vps");
    const data = await res.json();
    setConfigs(data);
  }

  useEffect(() => {
    fetchConfigs();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/vps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({
      name: "",
      host: "",
      port: 22,
      username: "",
      privateKey: "",
      password: "",
      authType: "key",
      isLocal: false,
    });
    await fetchConfigs();
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/vps/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setTestResult(data);
    } finally {
      setTesting(false);
    }
  }

  async function doDeleteConfig() {
    if (!deleteConfigTarget) return;
    await fetch(`/api/vps?id=${deleteConfigTarget.id}`, { method: "DELETE" });
    setDeleteConfigTarget(null);
    await fetchConfigs();
  }

  async function activateConfig(id: number) {
    await fetch("/api/vps/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await fetchConfigs();
    // System paths are per-VPS — tell that section to reload for the new server.
    window.dispatchEvent(new CustomEvent("gc:active-vps-changed"));
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted mt-1">Configure VPS connections and preferences</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 mb-8">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-6">
          Add VPS Connection
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
            <SensitiveInput
              label="Host"
              value={form.host}
              onChange={(v) => setForm({ ...form, host: v })}
              type="text"
              className="md:col-span-1"
            />
            <SensitiveInput
              label="Port"
              value={form.port}
              onChange={(v) => setForm({ ...form, port: parseInt(v) || 0 })}
              type="number"
              className="md:col-span-1"
            />
            <SensitiveInput
              label="Username"
              value={form.username}
              onChange={(v) => setForm({ ...form, username: v })}
              type="text"
              className="md:col-span-2"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-muted mb-1.5">Auth Type</label>
            <div className="flex gap-3">
              {["key", "password"].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm({ ...form, authType: type })}
                  className={`px-4 py-2 text-xs font-mono border rounded-lg transition-colors ${
                    form.authType === type
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border hover:border-border-hover"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {form.authType === "key" ? (
            <SensitiveInput
              label="Private Key"
              value={form.privateKey}
              onChange={(v) => setForm({ ...form, privateKey: v })}
              type="textarea"
              rows={6}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
            />
          ) : (
            <SensitiveInput
              label="Password"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              type="password"
            />
          )}

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isLocal"
              checked={form.isLocal}
              onChange={(e) => setForm({ ...form, isLocal: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
            <label htmlFor="isLocal" className="text-sm">
              Running on VPS (local exec, no SSH)
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={testConnection}
              disabled={testing}
              className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors"
            >
              Save Connection
            </button>
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-lg text-sm ${
                testResult.success
                  ? "bg-success/10 border border-success/30 text-success"
                  : "bg-error/10 border border-error/30 text-error"
              }`}
            >
              {testResult.message}
            </div>
          )}
        </form>
      </div>

      {/* Saved Configs */}
      {configs.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 mb-8">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">
            Saved Connections
          </h2>
          <p className="text-[11px] text-muted/70 mb-4 leading-relaxed">
            These are servers you <strong>switch between</strong> — not separate accounts. Exactly one
            connection is <span className="text-accent font-mono">active</span> at a time, and every page
            (dashboard, projects, containers, terminal) talks to whichever server is active. Switching
            changes which server GroundControl controls; each server keeps its own filesystem paths below.
          </p>
          <div className="space-y-3">
            {configs.map((config) => (
              <div
                key={config.id}
                className={`flex items-center justify-between py-3 px-4 rounded-lg border ${
                  config.isActive
                    ? "bg-accent/5 border-accent/40"
                    : "bg-background/50 border-transparent"
                }`}
              >
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {config.name}
                    {config.isActive ? (
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
                        active
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted font-mono mt-0.5 flex items-center gap-1 flex-wrap">
                    <SensitiveField value={`${config.username}@${config.host}:${config.port}`} />
                    <span>
                      · {config.authType} · {config.isLocal ? "local" : "ssh"}
                      {config.hasKey ? " · key set" : ""}
                      {config.hasPassword ? " · password set" : ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {config.isActive ? (
                    <span className="text-xs font-mono text-accent/70">current target</span>
                  ) : (
                    <button
                      onClick={() => activateConfig(config.id)}
                      className="text-xs font-mono px-3 py-1.5 border border-accent/30 text-accent rounded-lg hover:bg-accent/10 transition-colors"
                    >
                      Switch to this server
                    </button>
                  )}
                  <button
                    onClick={() => setDeleteConfigTarget(config)}
                    className="text-xs font-mono text-error/70 hover:text-error transition-colors"
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <ConfirmDelete
            open={!!deleteConfigTarget}
            resourceName={deleteConfigTarget?.name || ""}
            resourceType="VPS Connection"
            onConfirm={doDeleteConfig}
            onCancel={() => setDeleteConfigTarget(null)}
          />
        </div>
      )}

      {/* Change Password */}
      <ChangePasswordSection />

      {/* Database Backup / Restore */}
      <BackupRestoreSection />

      {/* System Paths */}
      <SystemPathsSection />

      {/* AI Configuration */}
      <AIConfigSection />

      {/* Admin: User Management */}
      <UserManagementSection />
    </div>
  );
}

function SystemPathsSection() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<string>("");
  const [pickerPath, setPickerPath] = useState("/");

  useEffect(() => {
    function load() {
      setLoading(true);
      fetch("/api/system-config")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setConfig(data);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
    load();
    // Reload when the active VPS changes (paths are per-VPS).
    window.addEventListener("gc:active-vps-changed", load);
    return () => window.removeEventListener("gc:active-vps-changed", load);
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/system-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectRoot: config.projectRoot,
          caddySitesDir: config.caddySitesDir,
          caddyFile: config.caddyFile,
          nginxSitesDir: config.nginxSitesDir,
          nginxLogPath: config.nginxLogPath,
          staticRoot: config.staticRoot,
          sshDefaultCwd: config.sshDefaultCwd,
          certDomain: config.certDomain,
          composeCommand: config.composeCommand || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig(data);
        setResult({ success: true, message: "System paths updated" });
      } else {
        setResult({ success: false, message: data.error || "Failed to update" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  function openPicker(key: string, currentValue: string) {
    setPickerTarget(key);
    setPickerPath(currentValue && currentValue.startsWith("/") ? currentValue : "/");
    setPickerOpen(true);
  }

  function onPickerSelect(path: string) {
    if (pickerTarget && config) {
      setConfig({ ...config, [pickerTarget]: path });
    }
    setPickerOpen(false);
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 mt-8 animate-pulse">
        <div className="h-4 bg-border rounded w-1/3 mb-4" />
        <div className="h-8 bg-border rounded mb-2" />
        <div className="h-8 bg-border rounded" />
      </div>
    );
  }

  const fields = [
    { key: "projectRoot", label: "Project Root", placeholder: "/opt", desc: "Base directory where your apps and projects are deployed (e.g. /opt, /var/www, /home/user/apps)" },
    { key: "caddySitesDir", label: "Caddy Sites Directory", placeholder: "/etc/caddy/sites", desc: "Directory containing individual Caddy site config files" },
    { key: "caddyFile", label: "Caddy Main Config", placeholder: "/etc/caddy/Caddyfile", desc: "Path to the main Caddyfile if sites are defined there instead of separate files" },
    { key: "nginxSitesDir", label: "Nginx Sites Directory", placeholder: "/etc/nginx/sites-available", desc: "Directory containing Nginx virtual host configs" },
    { key: "nginxLogPath", label: "Nginx Error Log", placeholder: "/var/log/nginx/error.log", desc: "Path to Nginx error log for debugging" },
    { key: "staticRoot", label: "Static Files Root", placeholder: "/var/www", desc: "Directory served for static websites and file hosting" },
    { key: "sshDefaultCwd", label: "SSH Default Working Directory", placeholder: "/root", desc: "Default directory when opening the terminal" },
    { key: "certDomain", label: "SSL Certificate Domain", placeholder: "yourdomain.com (optional)", desc: "Primary domain for SSL certificate generation and monitoring" },
    { key: "composeCommand", label: "Docker Compose Command", placeholder: "auto", desc: "Override the docker compose command. Leave empty for auto-detect. Options: docker compose, docker-compose, podman-compose" },
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-6 mt-8">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">
        System Paths <span className="text-accent normal-case">(for the active VPS)</span>
      </h2>
      <p className="text-[11px] text-muted/70 mb-6 leading-relaxed max-w-2xl">
        These paths describe the filesystem layout of the <strong>currently active</strong> server.
        Each VPS keeps its own set, so a second server with a different layout (different project root,
        Caddy/Nginx dirs, etc.) can be adapted independently — switch the active server above, then edit
        its paths here.
      </p>
      <form onSubmit={handleSave} className="space-y-4 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fields.map((f: any) => (
            <div key={f.key}>
              <label className="block text-xs font-mono text-muted mb-1">{f.label}</label>
              <p className="text-[10px] text-muted/60 mb-1.5 leading-relaxed">{f.desc}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config?.[f.key] || ""}
                  onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => openPicker(f.key, config?.[f.key] || "")}
                  className="shrink-0 px-2.5 py-2 border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
                  title="Browse VPS filesystem"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Paths"}
        </button>
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
      <VpsFilePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={onPickerSelect}
        initialPath={pickerPath}
      />
    </div>
  );
}

function AIConfigSection() {
  const [status, setStatus] = useState<{ configured: boolean; hasEnvKey: boolean } | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/ai/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setStatus(data))
      .catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openaiApiKey: key || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus(data);
        setResult({ success: true, message: data.configured ? "API key saved" : "API key cleared" });
        setKey("");
      } else {
        setResult({ success: false, message: data.error || "Failed to save" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 mt-8">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">AI Configuration</h2>
      <p className="text-[10px] text-muted/60 mb-6 leading-relaxed">
        Configure OpenAI API key for the GroundControl AI assistant. The key is stored server-side in a config file.
        If an environment variable OPENAI_API_KEY is set, it takes priority.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${status?.configured || status?.hasEnvKey ? "bg-success" : "bg-error"}`} />
        <span className="text-xs font-mono">
          {status?.hasEnvKey ? "Using env var OPENAI_API_KEY" : status?.configured ? "API key configured" : "No API key configured"}
        </span>
      </div>

      <form onSubmit={handleSave} className="space-y-3 max-w-md">
        <div>
          <label className="block text-xs font-mono text-muted mb-1">OpenAI API Key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-..."
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
          />
          <p className="text-[10px] text-muted/60 mt-1">Leave empty and save to clear the stored key.</p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save API Key"}
        </button>
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
  );
}

function BackupRestoreSection() {
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleBackup() {
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) throw new Error("Backup failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `groundcontrol-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setResult({ success: false, message: err.message });
    }
  }

  async function handleRestore(e: React.FormEvent) {
    e.preventDefault();
    if (!restoreFile) return;
    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", restoreFile);
      const res = await fetch("/api/backup", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: "Database restored. Refresh the page." });
        setRestoreFile(null);
      } else {
        setResult({ success: false, message: data.error || "Restore failed" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 mt-8">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-6">
        Database Backup & Restore
      </h2>
      <div className="space-y-4 max-w-md">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBackup}
            className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors"
          >
            Download Backup
          </button>
        </div>

        <form onSubmit={handleRestore} className="space-y-3">
          <div>
            <label className="block text-xs font-mono text-muted mb-1.5">Restore from file</label>
            <input
              type="file"
              accept=".db"
              onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
              className="w-full text-xs file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border file:bg-background file:text-foreground hover:file:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={!restoreFile || loading}
            className="px-4 py-2 text-xs font-mono bg-error/10 border border-error/30 text-error rounded-lg hover:bg-error/20 transition-colors disabled:opacity-50"
          >
            {loading ? "Restoring..." : "Restore Database"}
          </button>
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
    </div>
  );
}

function UserManagementSection() {
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [users, setUsers] = useState<{ id: number; username: string; role: string; createdAt: string }[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<{ id: number; username: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data))
      .catch(() => {});
  }, []);

  async function fetchUsers() {
    try {
      const res = await fetch("/api/auth/users");
      if (res.ok) setUsers(await res.json());
    } catch {
      setUsers([]);
    }
  }

  useEffect(() => {
    if (user?.role === "admin") fetchUsers();
  }, [user]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!newUsername || !newPassword) {
      setResult({ success: false, message: "Username and password required" });
      return;
    }
    if (newPassword.length < 8) {
      setResult({ success: false, message: "Password must be at least 8 characters" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: `User ${data.username} created` });
        setNewUsername("");
        setNewPassword("");
        fetchUsers();
      } else {
        setResult({ success: false, message: data.error || "Failed to create user" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  async function doDeleteUser() {
    if (!deleteUserTarget) return;
    try {
      const res = await fetch(`/api/auth/users?id=${deleteUserTarget.id}`, { method: "DELETE" });
      if (res.ok) fetchUsers();
    } catch {
      // ignore
    }
    setDeleteUserTarget(null);
  }

  if (!user || user.role !== "admin") return null;

  return (
    <div className="bg-card border border-border rounded-xl p-6 mt-8">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-6">
        User Management
      </h2>

      <form onSubmit={handleCreate} className="space-y-4 max-w-md mb-6">
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
          />
          <SensitiveInput
            label=""
            value={newPassword}
            onChange={setNewPassword}
            type="password"
            placeholder="Password (min 8)"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create User"}
        </button>
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

      <div className="space-y-2">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex items-center justify-between py-2 px-3 bg-background/50 rounded-lg"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{u.username}</span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-border text-muted">
                {u.role}
              </span>
            </div>
            {u.username !== user.username && (
              <button
                onClick={() => setDeleteUserTarget(u)}
                className="text-xs font-mono text-error/70 hover:text-error transition-colors"
              >
                delete
              </button>
            )}
          </div>
        ))}
      </div>

      <ConfirmDelete
        open={!!deleteUserTarget}
        resourceName={deleteUserTarget?.username || ""}
        resourceType="User"
        onConfirm={doDeleteUser}
        onCancel={() => setDeleteUserTarget(null)}
      />
    </div>
  );
}

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (newPassword !== confirmPassword) {
      setResult({ success: false, message: "New passwords do not match" });
      return;
    }
    if (newPassword.length < 8) {
      setResult({ success: false, message: "Password must be at least 8 characters" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: "Password updated successfully" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setResult({ success: false, message: data.error || "Failed to update password" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-6">
        Change Password
      </h2>
      <form onSubmit={handleChange} className="space-y-4 max-w-md">
        <SensitiveInput
          label="Current Password"
          value={currentPassword}
          onChange={setCurrentPassword}
          type="password"
        />
        <SensitiveInput
          label="New Password"
          value={newPassword}
          onChange={setNewPassword}
          type="password"
        />
        <SensitiveInput
          label="Confirm New Password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          type="password"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {loading ? "Updating..." : "Update Password"}
        </button>
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
  );
}
