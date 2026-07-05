"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

interface DiscoveredEnvEntry {
  key: string;
  source: string;
  scope: "deployment" | "component";
  component?: string;
  masked: string;
  hasValue: boolean;
}

async function json(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Invalid response" };
  }
}

export function DeploymentEnvPanel({ projectId, deploymentId, componentName, onRedeploy }: {
  projectId: number;
  deploymentId?: number;
  componentName?: string;
  onRedeploy?: () => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [profile, setProfile] = useState<EnvProfile | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredEnvEntry[]>([]);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [pastedEnv, setPastedEnv] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  const providerOptions = useMemo(() => providers.filter((provider) => provider.provider !== "local"), [providers]);
  const selectedProvider = providers.find((provider) => provider.id === profile?.providerAccountId);

  const load = useCallback(async () => {
    const [providersRes, profileRes] = await Promise.all([
      fetch("/api/env/providers").then(json),
      fetch(`/api/env/profiles?projectId=${projectId}${deploymentId ? `&deploymentId=${deploymentId}` : ""}`).then(json),
    ]);
    setProviders(Array.isArray(providersRes.providers) ? providersRes.providers : []);
    setProfile(profileRes.profile || null);
    setDiscovered(Array.isArray(profileRes.discovered?.entries) ? profileRes.discovered.entries : []);
    const initial: Record<string, string> = {};
    for (const entry of profileRes.profile?.schema || []) initial[entry.key] = "";
    for (const key of Object.keys(profileRes.profile?.values || {})) initial[key] = "";
    for (const entry of profileRes.discovered?.entries || []) {
      if (!componentName || !entry.component || entry.component === componentName) initial[entry.key] ||= "";
    }
    setLocalValues(initial);
  }, [projectId, deploymentId, componentName]);

  useEffect(() => {
    void Promise.resolve().then(load).catch(() => undefined);
  }, [load]);

  async function saveProfile(patch: Partial<EnvProfile> = {}, values?: Record<string, string>, importCurrentServerEnv = false) {
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
          importCurrentServerEnv,
        }),
      });
      const data = await json(res);
      if (!res.ok || data.error) setMessage(data.error || "Save failed");
      else {
        setProfile(data.profile);
        setDiscovered(Array.isArray(data.discovered?.entries) ? data.discovered.entries : discovered);
        const nextValues: Record<string, string> = {};
        for (const entry of data.profile?.schema || []) nextValues[entry.key] = "";
        for (const key of Object.keys(data.profile?.values || {})) nextValues[key] = "";
        for (const entry of data.discovered?.entries || []) {
          if (!componentName || !entry.component || entry.component === componentName) nextValues[entry.key] ||= "";
        }
        setLocalValues(nextValues);
        setMessage(importCurrentServerEnv ? "Current server env saved to source" : "Environment saved");
      }
    } finally {
      setLoading(false);
    }
  }

  if (!profile) {
    return <div className="rounded-lg bg-background/40 p-3 text-xs text-muted">Loading env profile...</div>;
  }

  const visibleDiscovered = componentName
    ? discovered.filter((entry) => entry.component === componentName || (entry.scope === "deployment" && entry.source === ".env"))
    : discovered;
  const discoveredByKey = new Map(visibleDiscovered.map((entry) => [entry.key, entry]));
  const envKeys = Array.from(new Set([
    ...(profile.schema || []).map((entry) => entry.key),
    ...Object.keys(profile.values || {}),
    ...visibleDiscovered.map((entry) => entry.key),
  ])).sort();
  const hasSavedSource = profile.providerType === "local"
    ? Object.keys(profile.values || {}).length > 0 || profile.schema.length > 0
    : !!profile.providerAccountId;

  return (
    <div className="space-y-3 rounded-lg bg-background/40 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-medium">Environment</div>
          <div className="text-[10px] font-mono text-muted">
            {componentName ? `${componentName} · ` : ""}
            {profile.providerType} · {profile.status || "unknown"}
            {profile.lastHash ? ` · ${profile.lastHash.slice(0, 12)}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!hasSavedSource && (
            <button
              onClick={() => {
                if (!sourceOpen) {
                  setSourceOpen(true);
                  return;
                }
                saveProfile({}, undefined, profile.providerType === "local");
              }}
              disabled={loading}
              className="rounded bg-background px-2 py-1 text-[10px] font-mono hover:bg-accent/10 hover:text-accent"
              title="Choose where environment values live. Local source imports current server values without exposing raw secrets in the browser."
            >
              Connect source <InfoMark />
            </button>
          )}
          <button
            onClick={() => {
              const changed = Object.fromEntries(Object.entries(localValues).filter(([, value]) => value));
              saveProfile({}, changed);
            }}
            disabled={loading}
            className="rounded bg-accent/10 px-2 py-1 text-[10px] font-mono text-accent hover:bg-accent/20"
            title="Store edited values in the selected environment source. It does not restart containers."
          >
            Save <InfoMark />
          </button>
          {onRedeploy && (
            <button
              onClick={onRedeploy}
              disabled={loading}
              className="rounded bg-success/10 px-2 py-1 text-[10px] font-mono text-success hover:bg-success/20"
              title="Redeploy the selected component or deployment so the runtime picks up saved env."
            >
              Redeploy <InfoMark />
            </button>
          )}
        </div>
      </div>

      {message && <div className="rounded bg-card p-2 text-[10px] font-mono text-muted">{message}</div>}

      <button
        type="button"
        onClick={() => setSourceOpen((open) => !open)}
        className="flex w-full items-center justify-between rounded-lg bg-card px-3 py-2 text-left text-xs font-mono text-muted transition-colors hover:bg-accent/5 hover:text-accent"
      >
        <span>Source: {selectedProvider && profile.providerType !== "local" ? selectedProvider.name : "Local encrypted .env"}</span>
        <span aria-hidden="true">{sourceOpen ? "−" : "+"}</span>
      </button>

      {sourceOpen && (
        <div className="grid grid-cols-1 gap-2 rounded-lg bg-card p-3 md:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-mono text-muted">Provider</span>
            <select
              value={profile.providerType === "infisical" ? String(profile.providerAccountId || "") : "local"}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "local") saveProfile({ providerType: "local", providerAccountId: null });
                else saveProfile({ providerType: "infisical", providerAccountId: Number(value) });
              }}
              className="w-full rounded bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
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
      )}

      {selectedProvider && profile.providerType !== "local" && (
        <div className="text-[10px] font-mono text-muted">
          External provider selected: {selectedProvider.name}
        </div>
      )}

      {!hasSavedSource && visibleDiscovered.length > 0 && (
        <div className="rounded-lg bg-accent/5 p-3 text-xs text-muted">
          Current server env is available and can be imported into the selected source without exposing raw secrets in the browser.
        </div>
      )}

      {profile.providerType === "local" && (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-lg bg-card">
            <div className="grid grid-cols-[1fr_1fr] bg-card px-3 py-2 text-[10px] font-mono text-muted md:grid-cols-[1fr_1fr_110px_110px]">
              <span>Key</span>
              <span>Value</span>
              <span className="hidden md:block">Source</span>
              <span className="hidden md:block">Status</span>
            </div>
            {envKeys.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted">No environment keys found yet.</div>
            ) : (
              envKeys.map((key) => {
                const schemaEntry = profile.schema.find((entry) => entry.key === key);
                const discoveredEntry = discoveredByKey.get(key);
                return (
                  <div key={key} className="grid grid-cols-1 gap-2 px-3 py-2 md:grid-cols-[1fr_1fr_110px_110px] md:items-center">
                    <div className="text-xs font-mono">
                      {key}{schemaEntry?.required ? " *" : ""}
                    </div>
                    <input
                      type="password"
                      value={localValues[key] || ""}
                      placeholder={profile.values?.[key]?.hasValue ? `keep ${profile.values[key].masked}` : "set value"}
                      onChange={(event) => setLocalValues({ ...localValues, [key]: event.target.value })}
                      className="w-full rounded bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
                    />
                    <div className="text-[10px] font-mono text-muted">
                      {profile.values?.[key]?.hasValue ? "saved" : discoveredEntry?.source || "new"}
                    </div>
                    <div className="text-[10px] font-mono text-muted">
                      {profile.values?.[key]?.hasValue ? "editable" : discoveredEntry?.hasValue ? `current ${discoveredEntry.masked}` : "needs value"}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="grid gap-2 rounded-lg bg-card p-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={newKey}
              onChange={(event) => setNewKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
              placeholder="NEW_KEY"
              className="rounded bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
            />
            <input
              type="password"
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              placeholder="value"
              className="rounded bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
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
              className="rounded bg-background px-3 py-2 text-xs font-mono text-muted hover:bg-accent/10 hover:text-accent disabled:opacity-50"
            >
              Add variable
            </button>
          </div>
          <div className="space-y-2 rounded-lg bg-card p-3">
            <input
              type="file"
              accept=".env,text/plain"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setPastedEnv(await file.text());
                event.currentTarget.value = "";
              }}
              className="block w-full text-xs font-mono text-muted file:mr-3 file:rounded file:border-0 file:bg-background file:px-3 file:py-2 file:text-xs file:font-mono file:text-muted hover:file:bg-accent/10 hover:file:text-accent"
            />
            <textarea
              value={pastedEnv}
              onChange={(event) => setPastedEnv(event.target.value)}
              placeholder="Paste .env contents"
              rows={4}
              className="w-full resize-y rounded bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={() => {
                const parsed = parseEnvText(pastedEnv);
                const keys = Object.keys(parsed);
                if (keys.length === 0) return;
                const nextSchema = [...profile.schema];
                const seen = new Set(nextSchema.map((entry) => entry.key));
                for (const key of keys) {
                  if (!seen.has(key)) {
                    seen.add(key);
                    nextSchema.push({ key, required: true });
                  }
                }
                setLocalValues({ ...localValues, ...parsed });
                setProfile({ ...profile, schema: nextSchema });
                setMessage(`${keys.length} value${keys.length === 1 ? "" : "s"} loaded from pasted env`);
              }}
              disabled={!pastedEnv.trim()}
              className="rounded bg-background px-3 py-2 text-xs font-mono text-muted hover:bg-accent/10 hover:text-accent disabled:opacity-50"
            >
              Fill from pasted env
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseEnvText(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

function InfoMark() {
  return <span aria-hidden="true" className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px]">i</span>;
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
        className="w-full rounded bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}
