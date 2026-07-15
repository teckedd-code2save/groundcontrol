"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";

export interface EnvironmentRedeployResult {
  success: boolean;
  missingEnvKeys?: string[];
}

interface Provider {
  id: number;
  name: string;
  provider: string;
}

interface DeploymentEnvironment {
  id: number;
  name: string;
  slug: string;
  isDefault: boolean;
  providerType: string;
  providerEnvironment: string;
  status: string;
}

interface InfisicalProject {
  id: string;
  name: string;
  slug: string;
  environments: Array<{ name: string; slug: string }>;
}

interface EnvValue {
  masked: string;
  hasValue: boolean;
}

interface EnvProfile {
  id: number;
  projectId: number;
  name: string;
  slug: string;
  isDefault: boolean;
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
  onRedeploy?: (component?: string, environmentSlug?: string) => void | EnvironmentRedeployResult | Promise<void | EnvironmentRedeployResult>;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [environments, setEnvironments] = useState<DeploymentEnvironment[]>([]);
  const [selectedEnvironment, setSelectedEnvironment] = useState("");
  const [profile, setProfile] = useState<EnvProfile | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredEnvEntry[]>([]);
  const [summary, setSummary] = useState<DiscoverySummary>(EMPTY_SUMMARY);
  const [components, setComponents] = useState<string[]>(componentName ? [componentName] : []);
  const [selectedComponent, setSelectedComponent] = useState(componentName || "");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [pastedEnv, setPastedEnv] = useState("");
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [missingKeys, setMissingKeys] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [environmentName, setEnvironmentName] = useState("");
  const [legacyUnassignedCount, setLegacyUnassignedCount] = useState(0);
  const [legacyUnassignedKeys, setLegacyUnassignedKeys] = useState<string[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [infisicalProjects, setInfisicalProjects] = useState<InfisicalProject[]>([]);

  const fixedScope = !!componentName;
  const scopeLabel = selectedComponent || "Choose a component";

  const hydrate = useCallback((data: Record<string, unknown>) => {
    const nextProfile = data.profile as EnvProfile | undefined;
    const nextEnvironments = Array.isArray(data.environments) ? data.environments as DeploymentEnvironment[] : [];
    const discovery = data.discovered as {
      entries?: DiscoveredEnvEntry[];
      summary?: DiscoverySummary;
    } | undefined;
    if (nextProfile) setProfile(nextProfile);
    setEnvironments(nextEnvironments);
    if (nextProfile) setSelectedEnvironment(nextProfile.slug);
    if (nextProfile) setMissingKeys(new Set(nextProfile.validation?.missing || []));
    setDiscovered(Array.isArray(discovery?.entries) ? discovery.entries : []);
    setSummary(discovery?.summary || EMPTY_SUMMARY);
    const nextComponents = Array.isArray(data.components) ? data.components as string[] : [];
    if (!fixedScope) {
      setComponents(nextComponents);
      setSelectedComponent((current) => current && nextComponents.includes(current) ? current : nextComponents[0] || "");
    }
    setDirtyKeys(new Set());
    setDraft({});
    setDeleteTarget(null);
    setLegacyUnassignedCount(Number(data.legacyUnassignedCount || 0));
    setLegacyUnassignedKeys(Array.isArray(data.legacyUnassignedKeys) ? data.legacyUnassignedKeys as string[] : []);
    setProviderError(typeof data.providerError === "string" ? data.providerError : null);
  }, [fixedScope]);

  const load = useCallback(async (environmentSlug?: string) => {
    setBusy("load");
    try {
      const query = new URLSearchParams({ projectId: String(projectId) });
      if (deploymentId) query.set("deploymentId", String(deploymentId));
      if (environmentSlug || selectedEnvironment) query.set("environment", environmentSlug || selectedEnvironment);
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
      hydrate(profileData);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }, [deploymentId, hydrate, projectId, selectedEnvironment]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDraft({});
    setDirtyKeys(new Set());
    setNotice(null);
  }, [selectedComponent]);

  useEffect(() => {
    if (profile?.providerType !== "infisical" || !profile.providerAccountId) {
      setInfisicalProjects([]);
      return;
    }
    let active = true;
    fetch(`/api/env/providers/catalog?providerAccountId=${profile.providerAccountId}`, { cache: "no-store" })
      .then(readJson)
      .then((data) => {
        if (!active) return;
        setInfisicalProjects(Array.isArray(data.projects) ? data.projects : []);
      })
      .catch(() => {
        if (active) setInfisicalProjects([]);
      });
    return () => { active = false; };
  }, [profile?.providerAccountId, profile?.providerType]);

  const selectedSavedValues = useMemo(() => selectedComponent
    ? profile?.componentValues?.[selectedComponent] || {}
    : {}, [profile?.componentValues, selectedComponent]);
  const selectedSchema = useMemo(() => selectedComponent
    ? (profile?.schema || []).filter((entry) => entry.component === selectedComponent)
    : [],
    [profile?.schema, selectedComponent]
  );
  const selectedDiscovered = useMemo(() => selectedComponent
    ? discovered.filter((entry) => entry.component === selectedComponent)
    : [], [discovered, selectedComponent]);
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
  const selectedInfisicalProject = infisicalProjects.find((project) => project.id === profile?.projectRef);
  const hasPendingChanges = dirtyKeys.size > 0;

  async function saveEnvironment(options: {
    values?: Record<string, string>;
    schema?: EnvProfile["schema"];
    reconcile?: boolean;
    deleteKeys?: string[];
    isDefault?: boolean;
    success?: string;
  } = {}) {
    if (!profile || (!selectedComponent && (options.values || options.reconcile || options.deleteKeys))) {
      setNotice({ tone: "error", text: "Choose the component that should receive these values." });
      return false;
    }
    setBusy(options.reconcile ? "reconcile" : "save");
    setNotice({
      tone: "info",
      text: options.reconcile
        ? `Reconciling ${selectedComponent} into ${profile.name}…`
        : `Saving ${scopeLabel} in ${profile.name}…`,
    });
    try {
      const response = await fetch("/api/env/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          profileId: profile.id,
          deploymentId,
          componentName: selectedComponent,
          name: profile.name,
          environmentSlug: profile.slug,
          isDefault: options.isDefault ?? profile.isDefault,
          providerType: profile.providerType,
          providerAccountId: profile.providerAccountId,
          providerEnvironment: profile.environment,
          secretPath: profile.secretPath,
          projectRef: profile.projectRef,
          schema: options.schema || profile.schema,
          values: options.values,
          reconcile: options.reconcile,
          deleteKeys: options.deleteKeys,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Environment save failed");
      hydrate(data);
      if (profile.providerType === "infisical") await load(profile.slug);
      setNotice({
        tone: "success",
        text: options.success || (options.reconcile
          ? `Reconciled ${scopeLabel} into ${profile.name}. No component was restarted.`
          : `Saved ${scopeLabel} in ${profile.name}. It will be injected on redeploy.`),
      });
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function deleteEnvironmentKey(key: string) {
    if (!profile) return;
    if (deleteTarget !== key) {
      setDeleteTarget(key);
      setNotice({ tone: "info", text: `Delete ${key} from ${scopeLabel}? Click the red delete button again to confirm.` });
      return;
    }
    const nextSchema = profile.schema.filter((entry) => !(
      entry.key === key && (entry.component || "") === selectedComponent
    ));
    await saveEnvironment({
      schema: nextSchema,
      deleteKeys: [key],
      success: `${key} removed from ${scopeLabel} in ${profile.name}.`,
    });
  }

  function currentValue(key: string) {
    return dirtyKeys.has(key) ? draft[key] || "" : "";
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

  async function createEnvironment() {
    if (!environmentName.trim() || !profile) return;
    setBusy("create");
    try {
      const response = await fetch("/api/env/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-environment",
          projectId,
          deploymentId,
          name: environmentName.trim(),
          copyFromProfileId: profile.id,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not create environment");
      const created = data.profile as EnvProfile;
      setEnvironmentName("");
      setCreateOpen(false);
      setSelectedEnvironment(created.slug);
      hydrate(data);
      setNotice({ tone: "success", text: `${created.name} created with the same requirements and no copied secret values.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function assignLegacyKey(key: string) {
    if (!profile || !selectedComponent) {
      setNotice({ tone: "info", text: "Choose the component that should receive this legacy key." });
      return;
    }
    setBusy(`assign-${key}`);
    try {
      const response = await fetch("/api/env/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign-legacy-key",
          projectId,
          deploymentId,
          profileId: profile.id,
          environmentSlug: profile.slug,
          componentName: selectedComponent,
          key,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not assign legacy key");
      hydrate(data);
      setNotice({ tone: "success", text: `${key} is now explicitly assigned to ${selectedComponent} in ${profile.name}.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
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
              Select a named runtime environment, then manage only the values explicitly assigned to each component. Values are injected when that environment is deployed.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => void load()} disabled={!!busy} icon={RefreshCw}>Refresh</ActionButton>
            <ActionButton onClick={() => setCreateOpen((open) => !open)} disabled={!!busy || hasPendingChanges} icon={Plus}>New environment</ActionButton>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="block min-w-56">
            <span className="gc-label">Runtime environment</span>
            <select
              value={selectedEnvironment || profile.slug}
              onChange={(event) => setSelectedEnvironment(event.target.value)}
              disabled={!!busy || hasPendingChanges}
              className="gc-field w-full"
            >
              {environments.map((environment) => (
                <option key={environment.id} value={environment.slug}>
                  {environment.name}{environment.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
            <span>{profile.providerType === "infisical" ? "Infisical" : "GroundControl Vault"}</span>
            <span>·</span>
            <span>{profile.providerType === "infisical" ? profile.environment : "encrypted at rest"}</span>
            {profile.isDefault && <span className="border border-success/30 bg-success/10 px-2 py-1 text-success">default</span>}
          </div>
        </div>
        {createOpen && (
          <div className="mt-4 grid gap-2 border border-accent/25 bg-accent/5 p-3 sm:grid-cols-[minmax(180px,1fr)_auto]">
            <input
              value={environmentName}
              onChange={(event) => setEnvironmentName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void createEnvironment(); }}
              placeholder="Staging"
              className="gc-field gc-field--compact"
              autoFocus
            />
            <ActionButton primary onClick={() => void createEnvironment()} disabled={!!busy || !environmentName.trim()} icon={Plus}>Create environment</ActionButton>
            <p className="text-[10px] leading-4 text-muted sm:col-span-2">Requirements and provider mapping are copied from {profile.name}; secret values are never copied.</p>
          </div>
        )}
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

      {providerError && (
        <div className="mx-4 mt-4 border border-error/30 bg-error/5 px-3 py-2 text-xs text-error md:mx-5" role="alert">
          Infisical connection failed: {providerError}
        </div>
      )}

      {legacyUnassignedKeys.length > 0 && (
        <div className="mx-4 mt-4 border border-warning/30 bg-warning/5 px-3 py-3 text-xs text-warning md:mx-5">
          <div>{legacyUnassignedKeys.length} legacy deployment-wide key{legacyUnassignedKeys.length === 1 ? "" : "s"} remain available for compatibility{legacyUnassignedCount ? `; ${legacyUnassignedCount} currently resolve to values` : ""}. Select a component, then assign each key explicitly.</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {legacyUnassignedKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => void assignLegacyKey(key)}
                disabled={!!busy || !selectedComponent}
                className="border border-warning/30 bg-background px-2 py-1 font-mono text-[9px] text-warning hover:border-warning/60 disabled:opacity-40"
              >
                {key} → {selectedComponent || "choose component"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`grid ${fixedScope ? "" : "md:grid-cols-[220px_minmax(0,1fr)]"}`}>
        {!fixedScope && (
          <aside className="border-b border-border bg-background/35 p-3 md:border-b-0 md:border-r">
            <div className="px-2 pb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">Deployment components</div>
            {components.map((component) => (
              <ScopeButton
                key={component}
                active={selectedComponent === component}
                label={component}
                detail={`${Object.keys(profile.componentValues?.[component] || {}).length} saved`}
                missingCount={[...missingKeys].filter((key) => key.startsWith(`${component}:`)).length}
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
                <Layers3 className="h-4 w-4 text-accent" />
                <h4 className="text-sm font-medium">{scopeLabel}</h4>
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted">
                {profile.name} · {profile.providerType === "infisical" ? `${profile.projectRef || "unlinked project"} / ${profile.environment}` : "write-only vault"}
                {profile.lastSyncedAt ? ` · deployed ${new Date(profile.lastSyncedAt).toLocaleString()}` : " · not deployed yet"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.providerType === "local" && (
                <ActionButton onClick={() => setReconcileOpen((open) => !open)} disabled={!!busy || !selectedComponent} icon={RotateCcw}>
                  Reconcile sources
                </ActionButton>
              )}
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
                    if (saved) {
                      const result = await onRedeploy(selectedComponent || undefined, profile.slug);
                      if (result && !result.success && result.missingEnvKeys?.length) {
                        const nextMissing = new Set(result.missingEnvKeys);
                        setMissingKeys(nextMissing);
                        const first = result.missingEnvKeys[0];
                        const separator = first.indexOf(":");
                        if (separator > 0) setSelectedComponent(first.slice(0, separator));
                        setNotice({ tone: "error", text: "Redeploy failed: Missing required env keys for this redeploy" });
                      }
                    }
                  }}
                  disabled={!!busy}
                  icon={ChevronRight}
                >
                  {selectedComponent ? `Deploy ${selectedComponent} to ${profile.name}` : `Deploy ${profile.name}`}
                </ActionButton>
              )}
            </div>
          </div>

          {reconcileOpen && profile.providerType === "local" && (
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
                  {busy === "reconcile" ? "Reconciling…" : `Reconcile ${selectedComponent}`}
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
              <span>{profile.providerType === "infisical" ? "Infisical state" : "Write-only value"}</span>
            </div>
            {keys.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="text-sm">No environment variables found</div>
                <p className="mt-1 text-xs text-muted">Add the first variable or reconcile values already running on this component.</p>
              </div>
            ) : keys.map((key) => {
              const entries = discoveredByKey.get(key) || [];
              const required = selectedSchema.find((entry) => entry.key === key)?.required;
              const scopedKey = selectedComponent ? `${selectedComponent}:${key}` : key;
              const isMissing = missingKeys.has(scopedKey);
              return (
                <div key={key} className={`grid grid-cols-[minmax(130px,.8fr)_minmax(180px,1.2fr)] items-center gap-3 border-t px-3 py-3 ${isMissing ? "border-error/50 bg-error/5" : "border-border"}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className={`truncate ${isMissing ? "text-error" : ""}`}>{key}</span>
                      {required && <span className="text-accent" title="Required">*</span>}
                      {dirtyKeys.has(key) && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Unsaved" />}
                    </div>
                    {isMissing && <div id={`missing-${selectedComponent || "component"}-${key}`} className="mt-1 font-mono text-[9px] text-error">Missing required value</div>}
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
                      type="password"
                      value={currentValue(key)}
                      placeholder={placeholderFor(key)}
                      disabled={profile.providerType === "infisical"}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, [key]: event.target.value }));
                        setDirtyKeys((current) => new Set(current).add(key));
                      }}
                      aria-label={`Value for ${key} in ${scopeLabel}`}
                      aria-invalid={isMissing}
                      aria-describedby={isMissing ? `missing-${selectedComponent || "component"}-${key}` : undefined}
                      className={`gc-field gc-field--compact min-w-0 flex-1 font-mono ${isMissing ? "border-error ring-1 ring-error/30" : ""}`}
                    />
                    {profile.providerType === "local" && (
                      <button
                        type="button"
                        onClick={() => void deleteEnvironmentKey(key)}
                        disabled={!!busy}
                        className={`gc-icon-button ${deleteTarget === key ? "border-error/60 bg-error/10 text-error" : ""}`}
                        aria-label={`${deleteTarget === key ? "Confirm deletion of" : "Delete"} ${key}`}
                        title={deleteTarget === key ? "Click again to confirm deletion" : "Delete managed variable"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
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
                    disabled={!!busy || !selectedComponent || !newKey}
                    onClick={async () => {
                      const key = newKey;
                      const ok = await saveEnvironment({
                        values: { [key]: newValue },
                        schema: schemaWith([key]),
                        success: `${key} added to ${scopeLabel} in ${profile.name}. It remains write-only and will be injected on redeploy.`,
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
                    disabled={!!busy || !selectedComponent || !pastedEnv.trim()}
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
                  <option value="local">GroundControl Vault</option>
                  {providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select>
              </label>
              {profile.providerType === "infisical" && infisicalProjects.length > 0 ? (
                <label className="block">
                  <span className="gc-label">Infisical project</span>
                  <select
                    value={profile.projectRef}
                    onChange={(event) => {
                      const project = infisicalProjects.find((item) => item.id === event.target.value);
                      setProfile({
                        ...profile,
                        projectRef: event.target.value,
                        environment: project?.environments[0]?.slug || profile.environment,
                      });
                    }}
                    className="gc-field w-full"
                  >
                    <option value="">Choose an existing project</option>
                    {infisicalProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
              ) : profile.providerType === "infisical" ? (
                <Field label="Provider project" value={profile.projectRef} onChange={(value) => setProfile({ ...profile, projectRef: value })} />
              ) : null}
              {profile.providerType === "infisical" && selectedInfisicalProject?.environments.length ? (
                <label className="block">
                  <span className="gc-label">Provider environment</span>
                  <select
                    value={profile.environment}
                    onChange={(event) => setProfile({ ...profile, environment: event.target.value })}
                    className="gc-field w-full"
                  >
                    {selectedInfisicalProject.environments.map((environment) => (
                      <option key={environment.slug} value={environment.slug}>{environment.name}</option>
                    ))}
                  </select>
                </label>
              ) : profile.providerType === "infisical" ? (
                <Field label="Provider environment" value={profile.environment} onChange={(value) => setProfile({ ...profile, environment: value })} />
              ) : null}
              {profile.providerType === "infisical" && (
                <Field label="Secret path" value={profile.secretPath} onChange={(value) => setProfile({ ...profile, secretPath: value })} />
              )}
              <div className="md:col-span-4 flex flex-wrap justify-end gap-2">
                {!profile.isDefault && (
                  <ActionButton onClick={() => void saveEnvironment({ isDefault: true, success: `${profile.name} is now the default deployment environment.` })} disabled={!!busy}>Make default</ActionButton>
                )}
                <ActionButton onClick={() => void saveEnvironment()} disabled={!!busy} icon={Save}>Save provider settings</ActionButton>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function ScopeButton({ active, label, detail, missingCount = 0, onClick }: {
  active: boolean;
  label: string;
  detail: string;
  missingCount?: number;
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
      <span className="flex shrink-0 items-center gap-2">
        {missingCount > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-error px-1.5 py-0.5 font-mono text-[9px] text-white">{missingCount}</span>}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
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
