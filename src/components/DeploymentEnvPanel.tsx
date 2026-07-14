"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  FileKey,
  Layers3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";

interface Provider {
  id: number;
  name: string;
  provider: string;
}

interface EnvValue {
  masked: string;
  hasValue: boolean;
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
  lastSyncedAt?: string | null;
  schema: Array<{ key: string; required: boolean; component?: string }>;
  validation?: { ok: boolean; missing: string[]; hash: string };
  values: Record<string, EnvValue>;
  componentValues: Record<string, Record<string, EnvValue>>;
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

async function readJson(response: Response) {
  const text = await response.text();
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
  onRedeploy?: (component?: string) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [profile, setProfile] = useState<EnvProfile | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredEnvEntry[]>([]);
  const [discoveredValues, setDiscoveredValues] = useState<Record<string, string>>({});
  const [scopedDiscoveredValues, setScopedDiscoveredValues] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<DiscoverySummary>(EMPTY_SUMMARY);
  const [components, setComponents] = useState<string[]>(componentName ? [componentName] : []);
  const [selectedComponent, setSelectedComponent] = useState(componentName || "");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [pastedEnv, setPastedEnv] = useState("");
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const fixedScope = !!componentName;
  const scopeLabel = selectedComponent || "Shared deployment";

  const hydrate = useCallback((data: Record<string, unknown>, reveal: boolean) => {
    const nextProfile = data.profile as EnvProfile | undefined;
    const discovery = data.discovered as {
      entries?: DiscoveredEnvEntry[];
      values?: Record<string, string>;
      scopedValues?: Record<string, string>;
      summary?: DiscoverySummary;
    } | undefined;
    if (nextProfile) setProfile(nextProfile);
    setDiscovered(Array.isArray(discovery?.entries) ? discovery.entries : []);
    setDiscoveredValues(reveal ? discovery?.values || {} : {});
    setScopedDiscoveredValues(reveal ? discovery?.scopedValues || {} : {});
    setSummary(discovery?.summary || EMPTY_SUMMARY);
    if (!fixedScope) setComponents(Array.isArray(data.components) ? data.components as string[] : []);
    setDirtyKeys(new Set());
    setRevealedKeys(reveal ? new Set(["*"]) : new Set());
    setDraft({});
  }, [fixedScope]);

  const load = useCallback(async (reveal = false) => {
    setBusy("load");
    try {
      const query = new URLSearchParams({ projectId: String(projectId) });
      if (deploymentId) query.set("deploymentId", String(deploymentId));
      if (reveal) query.set("reveal", "true");
      const [providersResponse, profileResponse] = await Promise.all([
        fetch("/api/env/providers", { cache: "no-store" }),
        fetch(`/api/env/profiles?${query.toString()}`, { cache: "no-store" }),
      ]);
      const [providerData, profileData] = await Promise.all([
        readJson(providersResponse),
        readJson(profileResponse),
      ]);
      if (!profileResponse.ok || profileData.error) throw new Error(profileData.error || "Environment load failed");
      setProviders(Array.isArray(providerData.providers) ? providerData.providers : []);
      hydrate(profileData, reveal);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }, [deploymentId, hydrate, projectId]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    setDraft({});
    setDirtyKeys(new Set());
    setRevealedKeys(new Set());
    setNotice(null);
  }, [selectedComponent]);

  const selectedSavedValues = useMemo(() => selectedComponent
    ? profile?.componentValues?.[selectedComponent] || {}
    : profile?.values || {}, [profile?.componentValues, profile?.values, selectedComponent]);
  const selectedSchema = useMemo(() =>
    (profile?.schema || []).filter((entry) => (entry.component || "") === selectedComponent),
    [profile?.schema, selectedComponent]
  );
  const selectedDiscovered = useMemo(() => discovered.filter((entry) =>
    selectedComponent ? entry.component === selectedComponent : !entry.component
  ), [discovered, selectedComponent]);
  const keys = useMemo(() => Array.from(new Set([
    ...selectedSchema.map((entry) => entry.key),
    ...Object.keys(selectedSavedValues),
    ...selectedDiscovered.map((entry) => entry.key),
  ])).sort(), [selectedDiscovered, selectedSavedValues, selectedSchema]);
  const discoveredByKey = useMemo(() => {
    const map = new Map<string, DiscoveredEnvEntry[]>();
    for (const entry of selectedDiscovered) map.set(entry.key, [...(map.get(entry.key) || []), entry]);
    return map;
  }, [selectedDiscovered]);
  const providerOptions = providers.filter((provider) => provider.provider !== "local");
  const allRevealed = revealedKeys.has("*");
  const hasPendingChanges = dirtyKeys.size > 0;

  async function saveEnvironment(options: {
    values?: Record<string, string>;
    schema?: EnvProfile["schema"];
    reconcile?: boolean;
    success?: string;
  } = {}) {
    if (!profile) return false;
    setBusy(options.reconcile ? "reconcile" : "save");
    setNotice({
      tone: "info",
      text: options.reconcile
        ? `Reconciling ${selectedComponent || "the whole deployment"}…`
        : `Saving ${scopeLabel} and materializing its managed environment…`,
    });
    try {
      const response = await fetch("/api/env/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          deploymentId,
          componentName: selectedComponent || undefined,
          providerType: profile.providerType,
          providerAccountId: profile.providerAccountId,
          environment: profile.environment,
          secretPath: profile.secretPath,
          projectRef: profile.projectRef,
          schema: options.schema || profile.schema,
          values: options.values,
          reconcile: options.reconcile,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Environment save failed");
      hydrate(data, false);
      const files = Array.isArray(data.materialized?.files) ? data.materialized.files.join(", ") : "managed source";
      setNotice({
        tone: "success",
        text: options.success || (options.reconcile
          ? `Reconciled ${scopeLabel}. GroundControl now owns a reproducible source in ${files}.`
          : `Saved ${scopeLabel}. Materialized ${files}.`),
      });
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function reveal(key?: string) {
    if (hasPendingChanges) {
      setNotice({ tone: "info", text: "Save or discard pending edits before revealing current values." });
      return;
    }
    if (key && revealedKeys.has(key)) {
      const next = new Set(revealedKeys);
      next.delete(key);
      setRevealedKeys(next);
      return;
    }
    await load(true);
    if (key) setRevealedKeys(new Set([key]));
  }

  function currentValue(key: string) {
    if (dirtyKeys.has(key)) return draft[key] || "";
    if (!allRevealed && !revealedKeys.has(key)) return "";
    if (selectedComponent) {
      return profile?.componentValues?.[selectedComponent]?.[key]?.masked
        ?? scopedDiscoveredValues[`${selectedComponent}:${key}`]
        ?? "";
    }
    return profile?.values?.[key]?.masked ?? discoveredValues[key] ?? "";
  }

  function placeholderFor(key: string) {
    const entries = discoveredByKey.get(key) || [];
    return selectedSavedValues[key]?.masked || entries.find((entry) => entry.hasValue)?.masked || "Not set";
  }

  function schemaWith(keysToAdd: string[]) {
    const next = [...(profile?.schema || [])];
    const seen = new Set(next.map((entry) => `${entry.component || ""}:${entry.key}`));
    for (const key of keysToAdd) {
      const id = `${selectedComponent}:${key}`;
      if (!seen.has(id)) next.push({ key, required: true, component: selectedComponent || undefined });
    }
    return next;
  }

  if (!profile) {
    return (
      <div className="gc-work-surface flex min-h-36 items-center justify-center text-xs text-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resolving environment sources…
      </div>
    );
  }

  return (
    <div className="gc-work-surface overflow-hidden">
      <div className="border-b border-border px-4 py-4 md:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="gc-eyebrow">Deployment configuration</div>
            <h3 className="mt-1 text-base font-semibold tracking-tight">Environment</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Values are grouped by the component that consumes them. Saving writes the encrypted source and its managed environment file immediately.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => void load(false)} disabled={!!busy} icon={RefreshCw}>Refresh</ActionButton>
            <ActionButton onClick={() => void reveal()} disabled={!!busy || hasPendingChanges} icon={allRevealed ? EyeOff : Eye}>
              {allRevealed ? "Mask values" : "Reveal values"}
            </ActionButton>
          </div>
        </div>
      </div>

      {notice && (
        <div className={`mx-4 mt-4 border px-3 py-2 text-xs md:mx-5 ${
          notice.tone === "success"
            ? "border-success/30 bg-success/10 text-success"
            : notice.tone === "error"
              ? "border-error/30 bg-error/10 text-error"
              : "border-border bg-background text-muted"
        }`} role="status">
          {notice.text}
        </div>
      )}

      <div className={`grid ${fixedScope ? "" : "md:grid-cols-[220px_minmax(0,1fr)]"}`}>
        {!fixedScope && (
          <aside className="border-b border-border bg-background/35 p-3 md:border-b-0 md:border-r">
            <div className="px-2 pb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">Configuration scope</div>
            <ScopeButton
              active={!selectedComponent}
              label="Shared deployment"
              detail={`${Object.keys(profile.values || {}).length} saved`}
              onClick={() => setSelectedComponent("")}
            />
            {components.map((component) => (
              <ScopeButton
                key={component}
                active={selectedComponent === component}
                label={component}
                detail={`${Object.keys(profile.componentValues?.[component] || {}).length} saved`}
                onClick={() => setSelectedComponent(component)}
              />
            ))}
            {components.length === 0 && (
              <div className="px-2 py-3 text-[11px] leading-4 text-muted">No Compose components discovered yet.</div>
            )}
          </aside>
        )}

        <div className="min-w-0 p-4 md:p-5">
          <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                {selectedComponent ? <Layers3 className="h-4 w-4 text-accent" /> : <FileKey className="h-4 w-4 text-accent" />}
                <h4 className="text-sm font-medium">{scopeLabel}</h4>
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted">
                {selectedComponent ? `.groundcontrol/env/${selectedComponent}.env` : ".env"}
                {profile.lastSyncedAt ? ` · synced ${new Date(profile.lastSyncedAt).toLocaleString()}` : " · not synchronized"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={() => setReconcileOpen((open) => !open)} disabled={!!busy} icon={RotateCcw}>
                Reconcile sources
              </ActionButton>
              <ActionButton
                primary
                onClick={() => void saveEnvironment({ values: Object.fromEntries([...dirtyKeys].map((key) => [key, draft[key] || ""])) })}
                disabled={!!busy || !hasPendingChanges}
                icon={Save}
              >
                Save changes
              </ActionButton>
              {onRedeploy && (
                <ActionButton
                  success
                  onClick={async () => {
                    const saved = hasPendingChanges
                      ? await saveEnvironment({ values: Object.fromEntries([...dirtyKeys].map((key) => [key, draft[key] || ""])) })
                      : true;
                    if (saved) onRedeploy(selectedComponent || undefined);
                  }}
                  disabled={!!busy}
                  icon={ChevronRight}
                >
                  Redeploy {selectedComponent || "deployment"}
                </ActionButton>
              )}
            </div>
          </div>

          {reconcileOpen && (
            <div className="mt-4 border border-accent/25 bg-accent/5 p-4">
              <div className="text-sm font-medium">Create one reproducible source</div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
                GroundControl will read declared files, resolved Compose values and the running process, then copy effective application values into its encrypted store. Existing source files are retained. System variables such as PATH and HOSTNAME are excluded.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <ActionButton
                  primary
                  onClick={() => void saveEnvironment({ reconcile: true })}
                  disabled={!!busy}
                  icon={busy === "reconcile" ? Loader2 : Check}
                >
                  {busy === "reconcile" ? "Reconciling…" : `Reconcile ${selectedComponent || "all components"}`}
                </ActionButton>
                <span className="font-mono text-[10px] text-muted">No container is restarted until you choose redeploy.</span>
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-px border border-border bg-border sm:grid-cols-3">
            <Metric label="Running" value={`${new Set(selectedDiscovered.filter((entry) => entry.runtime).map((entry) => entry.key)).size} keys`} detail={`${summary.runningContainerCount}/${summary.containerCount} containers`} />
            <Metric label="Declared" value={`${new Set(selectedDiscovered.filter((entry) => !entry.runtime).map((entry) => entry.key)).size} keys`} detail="Compose and env files" />
            <Metric label="Managed" value={`${Object.keys(selectedSavedValues).length} keys`} detail={profile.validation?.ok ? "Ready for redeploy" : `${profile.validation?.missing?.length || 0} required missing`} tone={profile.validation?.ok ? "success" : "warning"} />
          </div>

          <div className="mt-4 overflow-hidden border border-border">
            <div className="grid grid-cols-[minmax(130px,.8fr)_minmax(180px,1.2fr)] gap-3 bg-background/60 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
              <span>Variable and provenance</span>
              <span>Managed value</span>
            </div>
            {keys.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="text-sm">No environment variables found</div>
                <p className="mt-1 text-xs text-muted">Add the first variable or reconcile values already running on this component.</p>
              </div>
            ) : keys.map((key) => {
              const entries = discoveredByKey.get(key) || [];
              const required = selectedSchema.find((entry) => entry.key === key)?.required;
              const isRevealed = allRevealed || revealedKeys.has(key);
              return (
                <div key={key} className="grid grid-cols-[minmax(130px,.8fr)_minmax(180px,1.2fr)] items-center gap-3 border-t border-border px-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="truncate">{key}</span>
                      {required && <span className="text-accent" title="Required">*</span>}
                      {dirtyKeys.has(key) && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Unsaved" />}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entries.length > 0 ? entries.slice(0, 3).map((entry, index) => (
                        <span key={`${entry.source}-${index}`} className="border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] text-muted">
                          {entry.source}{entry.runtime ? " · live" : ""}
                        </span>
                      )) : <span className="font-mono text-[9px] text-muted">managed only</span>}
                    </div>
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <input
                      type={isRevealed ? "text" : "password"}
                      value={currentValue(key)}
                      placeholder={placeholderFor(key)}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, [key]: event.target.value }));
                        setDirtyKeys((current) => new Set(current).add(key));
                      }}
                      aria-label={`Value for ${key} in ${scopeLabel}`}
                      className="gc-field gc-field--compact min-w-0 flex-1 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => void reveal(key)}
                      disabled={!!busy || hasPendingChanges}
                      className="gc-icon-button"
                      aria-label={`${isRevealed ? "Hide" : "Reveal"} ${key}`}
                      title={`${isRevealed ? "Hide" : "Reveal"} current value`}
                    >
                      {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {profile.providerType === "local" && (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div className="border border-border p-4">
                <div className="gc-eyebrow">Add variable</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(120px,.8fr)_minmax(160px,1fr)_auto]">
                  <input
                    value={newKey}
                    onChange={(event) => setNewKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                    placeholder="VARIABLE_NAME"
                    className="gc-field gc-field--compact font-mono"
                  />
                  <input
                    type="password"
                    value={newValue}
                    onChange={(event) => setNewValue(event.target.value)}
                    placeholder="Value"
                    className="gc-field gc-field--compact font-mono"
                  />
                  <ActionButton
                    primary
                    disabled={!!busy || !newKey}
                    onClick={async () => {
                      const key = newKey;
                      const ok = await saveEnvironment({
                        values: { [key]: newValue },
                        schema: schemaWith([key]),
                        success: `${key} added to ${scopeLabel} and written to its managed environment file.`,
                      });
                      if (ok) {
                        setNewKey("");
                        setNewValue("");
                      }
                    }}
                    icon={Check}
                  >
                    Add
                  </ActionButton>
                </div>
              </div>

              <div className="border border-border p-4">
                <div className="gc-eyebrow">Import dotenv</div>
                <textarea
                  value={pastedEnv}
                  onChange={(event) => setPastedEnv(event.target.value)}
                  placeholder={"DATABASE_URL=…\nAPI_TOKEN=…"}
                  rows={3}
                  className="gc-field mt-3 w-full resize-y font-mono"
                />
                <div className="mt-2 flex justify-end">
                  <ActionButton
                    disabled={!!busy || !pastedEnv.trim()}
                    onClick={() => {
                      const parsed = parseEnvText(pastedEnv);
                      const importedKeys = Object.keys(parsed);
                      setDraft((current) => ({ ...current, ...parsed }));
                      setDirtyKeys((current) => new Set([...current, ...importedKeys]));
                      setProfile((current) => current ? { ...current, schema: schemaWith(importedKeys) } : current);
                      setNotice({ tone: "info", text: `${importedKeys.length} values staged for ${scopeLabel}. Review and save them.` });
                    }}
                  >
                    Stage values
                  </ActionButton>
                </div>
              </div>
            </div>
          )}

          <details className="mt-4 border border-border">
            <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium hover:bg-background/40">
              Source provider and advanced settings
            </summary>
            <div className="grid gap-3 border-t border-border p-4 md:grid-cols-4">
              <label className="block">
                <span className="gc-label">Source</span>
                <select
                  value={profile.providerType === "infisical" ? String(profile.providerAccountId || "") : "local"}
                  onChange={(event) => {
                    const value = event.target.value;
                    setProfile({
                      ...profile,
                      providerType: value === "local" ? "local" : "infisical",
                      providerAccountId: value === "local" ? null : Number(value),
                    });
                  }}
                  className="gc-field w-full"
                >
                  <option value="local">GroundControl encrypted</option>
                  {providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select>
              </label>
              <Field label="Provider project" value={profile.projectRef} onChange={(value) => setProfile({ ...profile, projectRef: value })} />
              <Field label="Environment" value={profile.environment} onChange={(value) => setProfile({ ...profile, environment: value })} />
              <Field label="Secret path" value={profile.secretPath} onChange={(value) => setProfile({ ...profile, secretPath: value })} />
              <div className="md:col-span-4 flex justify-end">
                <ActionButton onClick={() => void saveEnvironment()} disabled={!!busy} icon={Save}>Save provider settings</ActionButton>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function ScopeButton({ active, label, detail, onClick }: {
  active: boolean;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 flex w-full items-center justify-between border px-2.5 py-2 text-left transition-colors ${
        active ? "border-accent/40 bg-accent/10 text-foreground" : "border-transparent text-muted hover:border-border hover:bg-background/50 hover:text-foreground"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{label}</span>
        <span className="mt-0.5 block font-mono text-[9px] opacity-70">{detail}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}

function Metric({ label, value, detail, tone }: {
  label: string;
  value: string;
  detail: string;
  tone?: "success" | "warning";
}) {
  return (
    <div className="bg-card px-3 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`mt-1 text-sm font-medium ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : ""}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-muted">{detail}</div>
    </div>
  );
}

function ActionButton({ children, icon: Icon, primary, success, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ComponentType<{ className?: string }>;
  primary?: boolean;
  success?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`gc-button ${primary ? "gc-button--primary" : success ? "gc-button--success" : "gc-button--secondary"} ${props.className || ""}`}
    >
      {Icon && <Icon className={`h-3.5 w-3.5 ${Icon === Loader2 ? "animate-spin" : ""}`} />}
      {children}
    </button>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="gc-label">{label}</span>
      <input value={value || ""} onChange={(event) => onChange(event.target.value)} className="gc-field w-full" />
    </label>
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
