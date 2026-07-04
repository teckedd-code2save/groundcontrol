"use client";

import { useEffect, useState } from "react";

interface EnvProvider {
  id: number;
  name: string;
  provider: string;
  configJson: string;
  isActive: boolean;
  hasCredentials: boolean;
}

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Invalid response" };
  }
}

export default function EnvProvidersTab() {
  const [providers, setProviders] = useState<EnvProvider[]>([]);
  const [form, setForm] = useState({
    name: "Infisical",
    host: "",
    projectId: "",
    environment: "prod",
    secretPath: "/",
    clientId: "",
    clientSecret: "",
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const data = await fetch("/api/env/providers").then(readJson).catch(() => ({ providers: [] }));
    setProviders(Array.isArray(data.providers) ? data.providers : []);
  }

  useEffect(() => {
    load();
  }, []);

  async function saveProvider() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/env/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name || "Infisical",
          provider: "infisical",
          config: {
            host: form.host || "https://app.infisical.com",
            projectId: form.projectId,
            environment: form.environment || "prod",
            secretPath: form.secretPath || "/",
          },
          credentials: {
            clientId: form.clientId,
            clientSecret: form.clientSecret,
          },
        }),
      });
      const data = await readJson(res);
      if (!res.ok || data.error) setMessage(data.error || "Save failed");
      else {
        setMessage("Provider saved");
        setForm((prev) => ({ ...prev, clientSecret: "" }));
        await load();
      }
    } finally {
      setLoading(false);
    }
  }

  async function testProvider(providerId?: number) {
    setLoading(true);
    setMessage("");
    try {
      const body = providerId
        ? { providerId }
        : {
            provider: "infisical",
            config: {
              host: form.host || "https://app.infisical.com",
              projectId: form.projectId,
              environment: form.environment || "prod",
              secretPath: form.secretPath || "/",
            },
            credentials: { clientId: form.clientId, clientSecret: form.clientSecret },
          };
      const res = await fetch("/api/env/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      setMessage(data.ok ? `Connection ok (${data.count || 0} secrets visible)` : data.error || "Test failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-lg border border-border bg-card p-3 text-xs font-mono text-muted">
          {message}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-medium">Provider Accounts</h2>
        <div className="space-y-2">
          {providers.map((provider) => {
            let config: Record<string, string> = {};
            try { config = JSON.parse(provider.configJson || "{}"); } catch {}
            return (
              <div key={provider.id} className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-medium">{provider.name}</div>
                  <div className="text-[10px] font-mono text-muted">
                    {provider.provider}
                    {config.host ? ` · ${config.host}` : ""}
                    {config.projectId ? ` · ${config.projectId}` : ""}
                    {provider.hasCredentials ? " · credentials saved" : ""}
                  </div>
                </div>
                <button
                  onClick={() => testProvider(provider.id)}
                  disabled={loading || provider.provider === "local"}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-mono text-muted hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  Test
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-medium">Add Infisical Provider</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <Input label="Host" value={form.host} placeholder="https://app.infisical.com" onChange={(value) => setForm({ ...form, host: value })} />
          <Input label="Default Project ID" value={form.projectId} onChange={(value) => setForm({ ...form, projectId: value })} />
          <Input label="Environment" value={form.environment} onChange={(value) => setForm({ ...form, environment: value })} />
          <Input label="Secret Path" value={form.secretPath} onChange={(value) => setForm({ ...form, secretPath: value })} />
          <Input label="Client ID" value={form.clientId} onChange={(value) => setForm({ ...form, clientId: value })} />
          <Input label="Client Secret" type="password" value={form.clientSecret} onChange={(value) => setForm({ ...form, clientSecret: value })} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => testProvider()} disabled={loading} className="rounded-lg border border-border px-3 py-2 text-xs font-mono hover:border-accent">
            Test Unsaved
          </button>
          <button onClick={saveProvider} disabled={loading} className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent hover:bg-accent/20">
            Save Provider
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, placeholder, type = "text", onChange }: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-muted">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-accent"
      />
    </label>
  );
}
