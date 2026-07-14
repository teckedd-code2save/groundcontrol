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
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [pastedEnv, setPastedEnv] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [envPreviewOpen, setEnvPreviewOpen] = useState(false);
  const [revealEnvPreview, setRevealEnvPreview] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

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
    const scopedValues = reveal && profileRes.discovered?.scopedValues
      ? profileRes.discovered.scopedValues as Record<string, string>
      : {};
    const deploymentValues = reveal && profileRes.discovered?.values
      ? profileRes.discovered.values as Record<string, string>
      : {};
    const savedValues = profileRes.profile?.values || {};
    const keys = new Set<string>();
    for (const entry of profileRes.profile?.schema || []) keys.add(entry.key);
    for (const key of Object.keys(savedValues)) keys.add(key);
    for (const entry of profileRes.discovered?.entries || []) {
      if (!componentName || !entry.component || entry.component === componentName) keys.add(entry.key);
    }
    for (const key of keys) {
      const scoped = componentName ? scopedValues[`${componentName}:${key}`] : undefined;
      initial[key] = reveal
        ? scoped ?? deploymentValues[key] ?? savedValues[key]?.masked ?? ""
        : "";
    }
    setLocalValues(initial);
    setDirtyKeys(new Set());
  }, [projectId, deploymentId, componentName]);

  useEffect(() => {
    void Promise.resolve().then(() => load(undefined)).catch(() => undefined);
  }, [load]);

  async function toggleKeyReveal(key: string) {
    if (revealedKeys.has(key)) {
      setRevealedKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      return;
    }
    if (hasPendingChanges) {
      setMessage("Save or discard pending edits before revealing a current value.");
      return;
    }
    setLoading(true);
    try {
      await load(true);
      setRevealedKeys((current) => new Set(current).add(key));
      setMessage(`${key} revealed for this authenticated session.`);
    } finally {
      setLoading(false);
    }
  }

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
        setDirtyKeys(new Set());
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
    Object.entries(localValues).filter(([key]) => dirtyKeys.has(key))
  );
  const hasPendingChanges = dirtyKeys.size > 0;

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
          <button
            onClick={async () => {
              const next = !revealEnvPreview;
              setRevealEnvPreview(next);
              if (!next) setRevealedKeys(new Set());
              await load(next);
            }}
            disabled={loading || hasPendingChanges}
            className="rounded bg-background px-2 py-1 text-[10px] font-mono text-muted hover:bg-accent/10 hover:text-accent disabled:opacity-50"
            title={hasPendingChanges ? "Save or discard your edits before changing visibility." : "Explicitly reveal or mask saved and running values for this authenticated session."}
          >
            {revealEnvPreview ? "Mask all values" : "Reveal all values"}
          </button>
          <button
            onClick={() => setSourceOpen((open) => !open)}
            disabled={loading}
            aria-expanded={sourceOpen}
            className="rounded bg-foreground px-2.5 py-1 text-[10px] font-mono text-background hover:opacity-90 disabled:opacity-50"
          >
            {sourceOpen ? "Close management" : "Manage environment"}
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

      {sourceOpen && envPreviewOpen && (
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

      {sourceOpen && (
        <div className="space-y-4 rounded-lg border border-border bg-card p-3">
          <div className="flex flex-col gap-3 border-b border-border/70 pb-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-medium">Manage environment</div>
              <div className="mt-0.5 text-[10px] font-mono text-muted">
                {selectedProvider && profile.providerType !== "local" ? selectedProvider.name : "Local encrypted source"}
                {hasPendingChanges ? ` · ${dirtyKeys.size} unsaved change${dirtyKeys.size === 1 ? "" : "s"}` : " · no pending changes"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.providerType === "local" && runningEntries.length > 0 && (
                <button
                  onClick={() => saveProfile({}, undefined, true)}
                  disabled={loading}
                  className="rounded bg-background px-2.5 py-1.5 text-[10px] font-mono text-muted hover:text-accent disabled:opacity-50"
                >
                  Import running
                </button>
              )}
              <button
                onClick={() => load(revealEnvPreview)}
                disabled={loading}
                className="rounded bg-background px-2.5 py-1.5 text-[10px] font-mono text-muted hover:text-accent disabled:opacity-50"
              >
                Refresh
              </button>
              <button
                onClick={() => setEnvPreviewOpen((open) => !open)}
                disabled={loading}
                className="rounded bg-background px-2.5 py-1.5 text-[10px] font-mono text-muted hover:text-accent disabled:opacity-50"
              >
                {envPreviewOpen ? "Hide .env" : "Preview .env"}
              </button>
              <button
                onClick={() => saveProfile({}, pendingValues)}
                disabled={loading || !hasPendingChanges}
                className="rounded bg-accent/10 px-2.5 py-1.5 text-[10px] font-mono text-accent hover:bg-accent/20 disabled:opacity-40"
              >
                Save
              </button>
              {onRedeploy && (
                <button
                  onClick={async () => {
                    const saved = await saveProfile({}, pendingValues);
                    if (saved) onRedeploy();
                  }}
                  disabled={loading || !hasPendingChanges}
                  className="rounded bg-success/10 px-2.5 py-1.5 text-[10px] font-mono text-success hover:bg-success/20 disabled:opacity-40"
                >
                  Save &amp; redeploy
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[10px] font-mono text-muted">Source</span>
              <select
                value={profile.providerType === "infisical" ? String(profile.providerAccountId || "") : "local"}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "local") saveProfile({ providerType: "local", providerAccountId: null });
                  else saveProfile({ providerType: "infisical", providerAccountId: Number(value) });
                }}
                className="w-full rounded bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="local">Local encrypted</option>
                {providerOptions.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
            </label>
            <Input label="Provider project" value={profile.projectRef || ""} onChange={(value) => setProfile({ ...profile, projectRef: value })} onBlur={() => saveProfile({ projectRef: profile.projectRef })} />
            <Input label="Environment" value={profile.environment || "prod"} onChange={(value) => setProfile({ ...profile, environment: value })} onBlur={() => saveProfile({ environment: profile.environment })} />
            <Input label="Secret path" value={profile.secretPath || "/"} onChange={(value) => setProfile({ ...profile, secretPath: value })} onBlur={() => saveProfile({ secretPath: profile.secretPath })} />
          </div>
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
            <div className="grid grid-cols-[minmax(150px,.8fr)_minmax(180px,1.2fr)] gap-3 bg-card px-3 py-2 text-[10px] font-mono text-muted">
              <span>Key</span>
              <span>Value</span>
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
                  <div key={key} className="grid grid-cols-[minmax(150px,.8fr)_minmax(180px,1.2fr)] items-center gap-3 border-t border-border/60 px-3 py-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="truncate">{key}{schemaEntry?.required ? " *" : ""}</span>
                        {dirtyKeys.has(key) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Unsaved change" />}
                      </div>
                      <div className="mt-1 text-[9px] font-mono text-muted">
                        {discoveredEntry?.component ? `${discoveredEntry.component} · ` : ""}{source}
                        {discoveredEntry?.state ? ` · ${discoveredEntry.state}` : ""}
                      </div>
                    </div>
                    <div className="flex min-w-0 gap-2">
                      <input
                        type={revealEnvPreview || revealedKeys.has(key) ? "text" : "password"}
                        value={localValues[key] || ""}
                        aria-label={`Value for ${key}`}
                        placeholder={currentValue || "<unset>"}
                        onChange={(event) => {
                          setLocalValues({ ...localValues, [key]: event.target.value });
                          setDirtyKeys((current) => new Set(current).add(key));
                        }}
                        className="w-full rounded-md border border-transparent bg-background px-2.5 py-2 text-xs font-mono outline-none transition-colors placeholder:text-muted/70 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
                      />
                      <button
                        type="button"
                        onClick={() => void toggleKeyReveal(key)}
                        disabled={loading || hasPendingChanges}
                        className="shrink-0 rounded-md border border-border px-2.5 py-2 text-[10px] font-mono text-muted hover:border-accent/50 hover:text-accent disabled:opacity-40"
                        aria-label={`${revealedKeys.has(key) || revealEnvPreview ? "Hide" : "Reveal"} ${key}`}
                      >
                        {revealedKeys.has(key) || revealEnvPreview ? "Hide" : "Reveal"}
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
                setDirtyKeys((current) => new Set([...current, ...keys]));
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
