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
  container?: string;
  state?: string;
  runtime?: boolean;
  resolved?: boolean;
  masked: string;
  hasValue: boolean;
}

interface DiscoverySummary {
  containerCount: number;
  runningContainerCount: number;
  runtimeKeyCount: number;
  declaredKeyCount: number;
}

const EMPTY_SUMMARY: DiscoverySummary = {
  containerCount: 0,
  runningContainerCount: 0,
  runtimeKeyCount: 0,
  declaredKeyCount: 0,
};

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
  const [discoveredValues, setDiscoveredValues] = useState<Record<string, string>>({});
  const [scopedDiscoveredValues, setScopedDiscoveredValues] = useState<Record<string, string>>({});
  const [discoverySummary, setDiscoverySummary] = useState<DiscoverySummary>(EMPTY_SUMMARY);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [pastedEnv, setPastedEnv] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [envPreviewOpen, setEnvPreviewOpen] = useState(false);
  const [revealEnvPreview, setRevealEnvPreview] = useState(false);
  const [shownFields, setShownFields] = useState<Record<string, boolean>>({});

  const providerOptions = useMemo(() => providers.filter((provider) => provider.provider !== "local"), [providers]);
  const selectedProvider = providers.find((provider) => provider.id === profile?.providerAccountId);

  const load = useCallback(async (reveal?: boolean) => {
    const [providersRes, profileRes] = await Promise.all([
      fetch("/api/env/providers").then(json),
      fetch(`/api/env/profiles?projectId=${projectId}${deploymentId ? `&deploymentId=${deploymentId}` : ""}${reveal ? "&reveal=true" : ""}`).then(json),
    ]);
    setProviders(Array.isArray(providersRes.providers) ? providersRes.providers : []);
    setProfile(profileRes.profile || null);
    setDiscovered(Array.isArray(profileRes.discovered?.entries) ? profileRes.discovered.entries : []);
    setDiscoveredValues(reveal && profileRes.discovered?.values ? profileRes.discovered.values : {});
    setScopedDiscoveredValues(reveal && profileRes.discovered?.scopedValues ? profileRes.discovered.scopedValues : {});
    setDiscoverySummary(profileRes.discovered?.summary || EMPTY_SUMMARY);
    const initial: Record<string, string> = {};
    for (const entry of profileRes.profile?.schema || []) initial[entry.key] = "";
    for (const key of Object.keys(profileRes.profile?.values || {})) initial[key] = "";
    for (const entry of profileRes.discovered?.entries || []) {
      if (!componentName || !entry.component || entry.component === componentName) initial[entry.key] ||= "";
    }
    setLocalValues(initial);
  }, [projectId, deploymentId, componentName]);

  useEffect(() => {
    void Promise.resolve().then(() => load(undefined)).catch(() => undefined);
  }, [load]);

  async function saveProfile(patch: Partial<EnvProfile> = {}, values?: Record<string, string>, importCurrentServerEnv = false) {
    if (!profile) return false;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/env/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          deploymentId,
          componentName,
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
      if (!res.ok || data.error) {
        setMessage(data.error || "Save failed");
        return false;
      } else {
        setProfile(data.profile);
        setDiscovered(Array.isArray(data.discovered?.entries) ? data.discovered.entries : discovered);
        setDiscoverySummary(data.discovered?.summary || discoverySummary);
        const nextValues: Record<string, string> = {};
        for (const entry of data.profile?.schema || []) nextValues[entry.key] = "";
        for (const key of Object.keys(data.profile?.values || {})) nextValues[key] = "";
        for (const entry of data.discovered?.entries || []) {
          if (!componentName || !entry.component || entry.component === componentName) nextValues[entry.key] ||= "";
        }
        setLocalValues(nextValues);
        if (revealEnvPreview) {
          setRevealEnvPreview(false);
          setDiscoveredValues({});
          setScopedDiscoveredValues({});
        }
        setMessage(importCurrentServerEnv ? "Running environment imported into the encrypted source" : "Environment saved");
        return true;
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
  const runningEntries = visibleDiscovered.filter((entry) => entry.runtime);
  const envKeys = Array.from(new Set([
    ...(profile.schema || []).map((entry) => entry.key),
    ...Object.keys(profile.values || {}),
    ...visibleDiscovered.map((entry) => entry.key),
  ])).sort();
  const hasSavedSource = profile.providerType === "local"
    ? Object.keys(profile.values || {}).length > 0 || profile.schema.length > 0
    : !!profile.providerAccountId;
  const envPreview = buildEnvPreview(
    envKeys,
    localValues,
    profile,
    discoveredByKey,
    discoveredValues,
    scopedDiscoveredValues,
    componentName,
    revealEnvPreview
  );
  const pendingValues = Object.fromEntries(
    Object.entries(localValues).filter(([, value]) => value)
  );

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
          {profile.providerType === "local" && runningEntries.length > 0 && (
            <button
              onClick={() => saveProfile({}, undefined, true)}
              disabled={loading}
              className="rounded bg-background px-2 py-1 text-[10px] font-mono hover:bg-accent/10 hover:text-accent"
              title="Import the effective environment from running containers into GroundControl's encrypted local source."
            >
              Import running <InfoMark />
            </button>
          )}
          <button
            onClick={async () => {
              const next = !revealEnvPreview;
              setRevealEnvPreview(next);
              await load(next);
            }}
            disabled={loading}
            className="rounded bg-background px-2 py-1 text-[10px] font-mono text-muted hover:bg-accent/10 hover:text-accent disabled:opacity-50"
            title="Explicitly reveal or mask saved and running values for this authenticated session."
          >
            {revealEnvPreview ? "Mask values" : "Reveal values"}
          </button>
          <button
            onClick={() => load(revealEnvPreview)}
            disabled={loading}
            className="rounded bg-background px-2 py-1 text-[10px] font-mono text-muted hover:bg-accent/10 hover:text-accent disabled:opacity-50"
            title="Refresh Compose declarations, resolved configuration, and running container values."
          >
            Refresh
          </button>
          <button
            onClick={() => saveProfile({}, pendingValues)}
            disabled={loading}
            className="rounded bg-accent/10 px-2 py-1 text-[10px] font-mono text-accent hover:bg-accent/20"
            title="Store edited values in the selected environment source. It does not restart containers."
          >
            Save <InfoMark />
          </button>
          {onRedeploy && (
            <button
              onClick={async () => {
                const saved = await saveProfile({}, pendingValues);
                if (saved) onRedeploy();
              }}
              disabled={loading}
              className="rounded bg-success/10 px-2 py-1 text-[10px] font-mono text-success hover:bg-success/20"
              title="Save edited values, then open the redeploy flow so the runtime can pick them up."
            >
              Save &amp; redeploy <InfoMark />
            </button>
          )}
          <button
            onClick={() => setEnvPreviewOpen((open) => !open)}
            disabled={loading}
            className="rounded bg-background px-2 py-1 text-[10px] font-mono text-muted hover:bg-accent/10 hover:text-accent disabled:opacity-50"
            title="View and copy the environment file preview. Saved secrets stay masked until revealed."
          >
            .env <InfoMark />
          </button>
        </div>
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-3">
        <EnvSummary
          label="Running now"
          value={`${componentName ? new Set(runningEntries.map((entry) => entry.key)).size : discoverySummary.runtimeKeyCount} keys`}
          detail={`${discoverySummary.runningContainerCount}/${discoverySummary.containerCount} containers running`}
          tone={discoverySummary.runningContainerCount > 0 ? "good" : "muted"}
        />
        <EnvSummary
          label="Next deploy"
          value={`${discoverySummary.declaredKeyCount} declared`}
          detail="Compose + env files resolved"
        />
        <EnvSummary
          label="Saved source"
          value={`${Object.keys(profile.values || {}).length} keys`}
          detail={profile.validation?.ok ? "required values present" : `${profile.validation?.missing?.length || 0} required missing`}
          tone={profile.validation?.ok ? "good" : "warn"}
        />
      </div>

      {message && <div className="rounded bg-card p-2 text-[10px] font-mono text-muted">{message}</div>}

      {envPreviewOpen && (
        <div className="space-y-2 rounded-lg bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium">.env preview</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  const next = !revealEnvPreview;
                  setRevealEnvPreview(next);
                  await load(next);
                }}
                className="rounded bg-background px-2 py-1 text-[10px] font-mono text-muted hover:bg-accent/10 hover:text-accent"
              >
                {revealEnvPreview ? "Mask" : "Reveal"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(envPreview);
                  setMessage("Environment preview copied");
                }}
                className="rounded bg-background px-2 py-1 text-[10px] font-mono text-muted hover:bg-accent/10 hover:text-accent"
              >
                Copy
              </button>
            </div>
          </div>
          <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-[10px] font-mono text-foreground/80 whitespace-pre-wrap">
            {envPreview || "No environment keys found yet."}
          </pre>
        </div>
      )}

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
          GroundControl found environment values outside its saved source. Import the running values to make future redeploys reproducible.
        </div>
      )}

      {profile.providerType === "local" && (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-lg bg-card">
            <div className="hidden bg-card px-3 py-2 text-[10px] font-mono text-muted md:grid md:grid-cols-[minmax(170px,.8fr)_minmax(220px,1fr)_minmax(220px,1fr)] md:gap-3">
              <span>Key</span>
              <span>Effective now</span>
              <span>New value</span>
            </div>
            {envKeys.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted">No environment keys found yet.</div>
            ) : (
              envKeys.map((key) => {
                const schemaEntry = profile.schema.find((entry) => entry.key === key);
                const discoveredEntry = discoveredByKey.get(key);
                const revealedRunning = getDiscoveredValue(
                  key,
                  componentName,
                  discoveredValues,
                  scopedDiscoveredValues
                );
                const currentValue = revealEnvPreview
                  ? revealedRunning ?? profile.values?.[key]?.masked ?? ""
                  : discoveredEntry?.masked || profile.values?.[key]?.masked || "";
                const source = discoveredEntry?.source || (profile.values?.[key]?.hasValue ? "saved source" : "unset");
                return (
                  <div key={key} className="grid gap-2 border-t border-border/60 px-3 py-3 md:grid-cols-[minmax(170px,.8fr)_minmax(220px,1fr)_minmax(220px,1fr)] md:items-center md:gap-3">
                    <div>
                      <div className="text-xs font-mono">{key}{schemaEntry?.required ? " *" : ""}</div>
                      <div className="mt-1 text-[9px] font-mono text-muted">
                        {discoveredEntry?.component ? `${discoveredEntry.component} · ` : ""}{source}
                        {discoveredEntry?.state ? ` · ${discoveredEntry.state}` : ""}
                      </div>
                    </div>
                    <div className="min-w-0 rounded bg-background/70 px-2 py-1.5">
                      <div className="mb-1 text-[9px] font-mono uppercase tracking-wide text-muted md:hidden">Effective now</div>
                      <code className="block truncate text-[11px] text-foreground/80" title={revealEnvPreview ? currentValue : undefined}>
                        {currentValue || "<unset>"}
                      </code>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="sr-only">New value for {key}</span>
                      <input
                        type={shownFields[key] ? "text" : "password"}
                        value={localValues[key] || ""}
                        aria-label={`New value for ${key}`}
                        placeholder={currentValue ? "leave unchanged" : "set value"}
                        onChange={(event) => setLocalValues({ ...localValues, [key]: event.target.value })}
                        className="w-full rounded bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        onClick={() => setShownFields({ ...shownFields, [key]: !shownFields[key] })}
                        className="px-1.5 py-1.5 text-xs text-muted hover:text-foreground"
                        title={shownFields[key] ? "Hide" : "Show"}
                      >
                        {shownFields[key] ? "🙈" : "👁"}
                      </button>
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

function buildEnvPreview(
  keys: string[],
  localValues: Record<string, string>,
  profile: EnvProfile,
  discoveredByKey: Map<string, DiscoveredEnvEntry>,
  discoveredValues: Record<string, string>,
  scopedDiscoveredValues: Record<string, string>,
  componentName: string | undefined,
  reveal: boolean
): string {
  return keys
    .map((key) => {
      const entered = localValues[key];
      const saved = profile.values?.[key];
      if (entered) return `${key}=${quoteEnvValue(entered)}`;
      if (reveal && saved?.hasValue) return `${key}=${quoteEnvValue(saved.masked)}`;
      if (reveal) {
        const discovered = getDiscoveredValue(
          key,
          componentName,
          discoveredValues,
          scopedDiscoveredValues
        );
        if (discovered !== undefined) return `${key}=${quoteEnvValue(discovered)}`;
      }
      if (saved?.hasValue || discoveredByKey.get(key)?.hasValue) {
        return `${key}=••••••••`;
      }
      return `${key}=<unset>`;
    })
    .join("\n");
}

function getDiscoveredValue(
  key: string,
  componentName: string | undefined,
  discoveredValues: Record<string, string>,
  scopedDiscoveredValues: Record<string, string>
): string | undefined {
  if (componentName) {
    const scoped = scopedDiscoveredValues[`${componentName}:${key}`];
    if (scoped !== undefined) return scoped;
  }
  return discoveredValues[key];
}

function quoteEnvValue(value: string): string {
  if (!value) return "";
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function InfoMark() {
  return <span aria-hidden="true" className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-current/10 text-[9px]">i</span>;
}

function EnvSummary({ label, value, detail, tone = "muted" }: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "warn" | "muted";
}) {
  const valueClass = tone === "good"
    ? "text-success"
    : tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "text-foreground";
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="text-[9px] font-mono uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xs font-mono ${valueClass}`}>{value}</div>
      <div className="mt-0.5 text-[9px] text-muted">{detail}</div>
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
        className="w-full rounded bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}
