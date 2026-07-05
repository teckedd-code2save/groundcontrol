"use client";

import { useEffect, useMemo, useState } from "react";

interface Provider {
  id: number;
  name: string;
  provider: string;
  configJson: string;
}

interface EnvProfile {
  id: number;
  projectId: number;
  providerType: string;
  providerAccountId: number | null;
  environment: string;
  secretPath: string;
  projectRef: string;
  status: string;
  lastHash?: string | null;
  schema: { key: string; required: boolean }[];
  validation?: { ok: boolean; missing: string[]; hash: string };
  values?: Record<string, { masked: string; hasValue: boolean }>;
}

async function json(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Invalid response" };
  }
}

export function DeploymentEnvPanel({ projectId, deploymentId, onRedeploy }: {
  projectId: number;
  deploymentId?: number;
  onRedeploy?: () => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [profile, setProfile] = useState<EnvProfile | null>(null);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const providerOptions = useMemo(() => providers.filter((provider) => provider.provider !== "local"), [providers]);
  const selectedProvider = providers.find((provider) => provider.id === profile?.providerAccountId);

  async function load() {
    const [providersRes, profileRes] = await Promise.all([
      fetch("/api/env/providers").then(json),
      fetch(`/api/env/profiles?projectId=${projectId}${deploymentId ? `&deploymentId=${deploymentId}` : ""}`).then(json),
    ]);
    setProviders(Array.isArray(providersRes.providers) ? providersRes.providers : []);
    setProfile(profileRes.profile || null);
    const initial: Record<string, string> = {};
    for (const entry of profileRes.profile?.schema || []) initial[entry.key] = "";
    for (const key of Object.keys(profileRes.profile?.values || {})) initial[key] = "";
    setLocalValues(initial);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [projectId, deploymentId]);

  async function saveProfile(patch: Partial<EnvProfile> = {}, values?: Record<string, string>) {
    if (!profile) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/env/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          deploymentId,
          providerType: patch.providerType || profile.providerType,
          providerAccountId: patch.providerAccountId ?? profile.providerAccountId,
          environment: patch.environment ?? profile.environment,
          secretPath: patch.secretPath ?? profile.secretPath,
          projectRef: patch.projectRef ?? profile.projectRef,
          schema: patch.schema || profile.schema || [],
          values,
        }),
      });
      const data = await json(res);
      if (!res.ok || data.error) setMessage(data.error || "Save failed");
      else {
        setProfile(data.profile);
        const nextValues: Record<string, string> = {};
        for (const entry of data.profile?.schema || []) nextValues[entry.key] = "";
        for (const key of Object.keys(data.profile?.values || {})) nextValues[key] = "";
        setLocalValues(nextValues);
        setMessage("Env profile saved");
      }
    } finally {
      setLoading(false);
    }
  }

  async function action(kind: "validate" | "sync" | "materialize") {
    if (!profile) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`/api/env/profiles/${profile.id}/${kind}`, { method: "POST" });
      const data = await json(res);
      if (!res.ok || data.error) {
        setMessage(data.error || `${kind} failed`);
      } else {
        const label = kind === "materialize" ? "Environment applied" : kind === "sync" ? "Environment synced" : "Environment validated";
        setMessage(`${label}${data.validation?.missing?.length ? `; missing ${data.validation.missing.join(", ")}` : ""}`);
        await load();
      }
    } finally {
      setLoading(false);
    }
  }

  if (!profile) {
    return <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-muted">Loading env profile...</div>;
  }

  const envKeys = Array.from(new Set([...(profile.schema || []).map((entry) => entry.key), ...Object.keys(profile.values || {})])).sort();

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-medium">Environment</div>
          <div className="text-[10px] font-mono text-muted">
            {profile.providerType} · {profile.status || "unknown"}
            {profile.lastHash ? ` · ${profile.lastHash.slice(0, 12)}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => action("validate")} disabled={loading} className="rounded border border-border px-2 py-1 text-[10px] font-mono hover:border-accent">Validate env</button>
          <button onClick={() => action("sync")} disabled={loading} className="rounded border border-border px-2 py-1 text-[10px] font-mono hover:border-accent">Sync env</button>
          <button onClick={() => action("materialize")} disabled={loading} className="rounded border border-border px-2 py-1 text-[10px] font-mono hover:border-accent">Apply env</button>
          {onRedeploy && <button onClick={onRedeploy} disabled={loading} className="rounded border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] font-mono text-accent">Redeploy</button>}
        </div>
      </div>

      {message && <div className="rounded border border-border bg-card p-2 text-[10px] font-mono text-muted">{message}</div>}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-mono text-muted">Provider</span>
          <select
            value={profile.providerType === "infisical" ? String(profile.providerAccountId || "") : "local"}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "local") saveProfile({ providerType: "local", providerAccountId: null });
              else saveProfile({ providerType: "infisical", providerAccountId: Number(value) });
            }}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs font-mono"
          >
            <option value="local">Local encrypted .env</option>
            {providerOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
        </label>
        <Input label="Project ID" value={profile.projectRef || ""} onChange={(value) => setProfile({ ...profile, projectRef: value })} onBlur={() => saveProfile({ projectRef: profile.projectRef })} />
        <Input label="Environment" value={profile.environment || "prod"} onChange={(value) => setProfile({ ...profile, environment: value })} onBlur={() => saveProfile({ environment: profile.environment })} />
        <Input label="Path" value={profile.secretPath || "/"} onChange={(value) => setProfile({ ...profile, secretPath: value })} onBlur={() => saveProfile({ secretPath: profile.secretPath })} />
      </div>

      {selectedProvider && profile.providerType !== "local" && (
        <div className="text-[10px] font-mono text-muted">
          External provider selected: {selectedProvider.name}
        </div>
      )}

      {profile.providerType === "local" && (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[1fr_1fr] bg-card px-3 py-2 text-[10px] font-mono text-muted md:grid-cols-[1fr_1fr_120px]">
              <span>Key</span>
              <span>Value</span>
              <span className="hidden md:block">Status</span>
            </div>
            {envKeys.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted">No environment variables yet.</div>
            ) : (
              envKeys.map((key) => {
                const schemaEntry = profile.schema.find((entry) => entry.key === key);
                return (
                  <div key={key} className="grid grid-cols-1 gap-2 border-t border-border px-3 py-2 md:grid-cols-[1fr_1fr_120px] md:items-center">
                    <div className="text-xs font-mono">
                      {key}{schemaEntry?.required ? " *" : ""}
                    </div>
                    <input
                      type="password"
                      value={localValues[key] || ""}
                      placeholder={profile.values?.[key]?.hasValue ? `keep ${profile.values[key].masked}` : "set value"}
                      onChange={(event) => setLocalValues({ ...localValues, [key]: event.target.value })}
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs font-mono"
                    />
                    <div className="text-[10px] font-mono text-muted">
                      {profile.values?.[key]?.hasValue ? "saved" : "missing"}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="grid gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={newKey}
              onChange={(event) => setNewKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
              placeholder="NEW_KEY"
              className="rounded border border-border bg-background px-2 py-1.5 text-xs font-mono"
            />
            <input
              type="password"
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              placeholder="value"
              className="rounded border border-border bg-background px-2 py-1.5 text-xs font-mono"
            />
            <button
              onClick={() => {
                if (!newKey) return;
                const nextSchema = profile.schema.some((entry) => entry.key === newKey)
                  ? profile.schema
                  : [...profile.schema, { key: newKey, required: true }];
                saveProfile({ schema: nextSchema }, newValue ? { [newKey]: newValue } : undefined);
                setNewKey("");
                setNewValue("");
              }}
              disabled={loading || !newKey}
              className="rounded border border-border px-3 py-2 text-xs font-mono text-muted hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Add variable
            </button>
          </div>
          <button
            onClick={() => {
              const changed = Object.fromEntries(Object.entries(localValues).filter(([, value]) => value));
              saveProfile({}, changed);
            }}
            disabled={loading}
            className="rounded border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent"
          >
            Save local values
          </button>
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, onBlur }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-mono text-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs font-mono"
      />
    </label>
  );
}
