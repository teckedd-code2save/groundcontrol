"use client";

import { useEffect, useState } from "react";

interface VpsConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  isLocal: boolean;
  createdAt: string;
}

export default function SettingsPage() {
  const [configs, setConfigs] = useState<VpsConfig[]>([]);
  const [form, setForm] = useState({
    name: "primary",
    host: "128.140.12.62",
    port: 22,
    username: "root",
    privateKey: "",
    password: "",
    authType: "key",
    isLocal: false,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
      name: "primary",
      host: "128.140.12.62",
      port: 22,
      username: "root",
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

  async function deleteConfig(id: number) {
    await fetch(`/api/vps?id=${id}`, { method: "DELETE" });
    await fetchConfigs();
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
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Host</label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
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
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Private Key</label>
              <textarea
                value={form.privateKey}
                onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                rows={6}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent transition-colors resize-none"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
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
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">
            Saved Connections
          </h2>
          <div className="space-y-3">
            {configs.map((config) => (
              <div
                key={config.id}
                className="flex items-center justify-between py-3 px-4 bg-background/50 rounded-lg"
              >
                <div>
                  <div className="font-medium text-sm">{config.name}</div>
                  <div className="text-xs text-muted font-mono mt-0.5">
                    {config.username}@{config.host}:{config.port} · {config.authType} ·{" "}
                    {config.isLocal ? "local" : "ssh"}
                  </div>
                </div>
                <button
                  onClick={() => deleteConfig(config.id)}
                  className="text-xs font-mono text-error/70 hover:text-error transition-colors"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
