"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Download,
  FileUp,
  KeyRound,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { Notice } from "@/components/ui";

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
  schema: Array<{ key: string; required: boolean; component?: string }>;
  validation?: { ok: boolean; missing: string[]; hash: string };
  values: Record<string, EnvValue>;
  componentValues: Record<string, Record<string, EnvValue>>;
}

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
  const [components, setComponents] = useState<string[]>(componentName ? [componentName] : []);
  const [selectedComponent, setSelectedComponent] = useState(componentName || "");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [pastedEnv, setPastedEnv] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [missingKeys, setMissingKeys] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [environmentName, setEnvironmentName] = useState("");
  const [providerError, setProviderError] = useState<string | null>(null);
  const [infisicalProjects, setInfisicalProjects] = useState<InfisicalProject[]>([]);

  const fixedScope = Boolean(componentName);
  const scopeLabel = selectedComponent || "Deployment-wide";

  const hydrate = useCallback((data: Record<string, unknown>) => {
    const nextProfile = data.profile as EnvProfile | undefined;
    const nextEnvironments = Array.isArray(data.environments) ? data.environments as DeploymentEnvironment[] : [];
    if (nextProfile) {
      setProfile(nextProfile);
      setSelectedEnvironment(nextProfile.slug);
      setMissingKeys(new Set(nextProfile.validation?.missing || []));
    }
    setEnvironments(nextEnvironments);
    const nextComponents = Array.isArray(data.components) ? data.components as string[] : [];
    if (!fixedScope) {
      setComponents(nextComponents);
      setSelectedComponent((current) => {
        if (current === "") return ""; // stay on Deployment-wide
        return current && nextComponents.includes(current) ? current : nextComponents[0] || "";
      });
    }
    setDraft({});
    setDirtyKeys(new Set());
    setDeleteTarget(null);
    setProviderError(typeof data.providerError === "string" ? data.providerError : null);
  }, [fixedScope]);

  const load = useCallback(async (environmentSlug?: string) => {
    setBusy("load");
    try {
      const query = new URLSearchParams({ projectId: String(projectId) });
      if (deploymentId) query.set("deploymentId", String(deploymentId));
      if (environmentSlug) query.set("environment", environmentSlug);
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
  }, [deploymentId, hydrate, projectId]);

  useEffect(() => {
    void load(selectedEnvironment || undefined);
  }, [load, selectedEnvironment]);

  useEffect(() => {
    setDraft({});
    setDirtyKeys(new Set());
    setDeleteTarget(null);
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
        if (active) setInfisicalProjects(Array.isArray(data.projects) ? data.projects : []);
      })
      .catch(() => {
        if (active) setInfisicalProjects([]);
      });
    return () => { active = false; };
  }, [profile?.providerAccountId, profile?.providerType]);

  const selectedSavedValues = useMemo(() => selectedComponent
    ? profile?.componentValues?.[selectedComponent] || {}
    : profile?.values || {}, [profile?.componentValues, profile?.values, selectedComponent]);
  const selectedSchema = useMemo(() => selectedComponent
    ? (profile?.schema || []).filter((entry) => (entry.component || "") === selectedComponent)
    : (profile?.schema || []).filter((entry) => !entry.component || entry.component === ""),
    [profile?.schema, selectedComponent]);
  const keys = useMemo(() => Array.from(new Set([
    ...selectedSchema.map((entry) => entry.key),
    ...Object.keys(selectedSavedValues),
  ])).sort(), [selectedSavedValues, selectedSchema]);
  const providerOptions = providers.filter((provider) => provider.provider !== "local");
  const selectedInfisicalProject = infisicalProjects.find((item) => item.id === profile?.projectRef);
  const hasPendingChanges = dirtyKeys.size > 0;

  async function saveEnvironment(options: {
    values?: Record<string, string>;
    schema?: EnvProfile["schema"];
    deleteKeys?: string[];
    isDefault?: boolean;
    success?: string;
  } = {}) {
    if (!profile || (!selectedComponent && !options.values && !options.deleteKeys)) {
      setNotice({ tone: "error", text: "No changes to save." });
      return false;
    }
    setBusy("save");
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
          deleteKeys: options.deleteKeys,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Environment save failed");
      hydrate(data);
      if (profile.providerType === "infisical") await load(profile.slug);
      setNotice({
        tone: "success",
        text: options.success || `Saved ${scopeLabel} secrets for ${profile.name}. They will be used on the next deployment.`,
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
      setNotice({ tone: "info", text: `Select delete again to remove ${key} from ${scopeLabel}.` });
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

  function schemaWith(keysToAdd: string[]) {
    const next = [...(profile?.schema || [])];
    const seen = new Set(next.map((entry) => `${entry.component || ""}:${entry.key}`));
    for (const key of keysToAdd) {
      const id = `${selectedComponent}:${key}`;
      if (!seen.has(id)) next.push({ key, required: false, component: selectedComponent || undefined });
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
      hydrate(data);
      setSelectedEnvironment(created.slug);
      setNotice({ tone: "success", text: `${created.name} created without copying secret values.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  function stageImportedValues(content: string) {
    const parsed = parseEnvText(content);
    const importedKeys = Object.keys(parsed);
    if (importedKeys.length === 0) {
      setNotice({ tone: "error", text: "No valid environment variables were found in that file." });
      return;
    }
    setDraft((current) => ({ ...current, ...parsed }));
    setDirtyKeys((current) => new Set([...current, ...importedKeys]));
    setProfile((current) => current ? { ...current, schema: schemaWith(importedKeys) } : current);
    setImportOpen(false);
    setPastedEnv("");
    setNotice({ tone: "info", text: `${importedKeys.length} secrets staged for ${scopeLabel}. Save changes when ready.` });
  }

  if (!profile) {
    return (
      <div className="gc-work-surface flex min-h-36 items-center justify-center text-xs text-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading environment…
      </div>
    );
  }

  const exportHref = selectedComponent
    ? `/api/env/profiles/${profile.id}/export?component=${encodeURIComponent(selectedComponent)}`
    : "";

  return (
    <div className="gc-work-surface overflow-hidden">
      <div className="border-b border-border px-4 py-4 md:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-base font-semibold tracking-tight">Environment</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Secrets belong to a named environment and component. GroundControl never infers them from host files or running containers.
            </p>
          </div>
          <div className="flex gap-2">
            <ActionButton onClick={() => void load(profile.slug)} disabled={Boolean(busy)} icon={RefreshCw}>Refresh</ActionButton>
            <ActionButton onClick={() => setCreateOpen((open) => !open)} disabled={Boolean(busy) || hasPendingChanges} icon={Plus}>New environment</ActionButton>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="block min-w-56">
            <span className="gc-label">Environment</span>
            <select
              value={selectedEnvironment || profile.slug}
              onChange={(event) => setSelectedEnvironment(event.target.value)}
              disabled={Boolean(busy) || hasPendingChanges}
              className="gc-field w-full"
            >
              {environments.map((environment) => (
                <option key={environment.id} value={environment.slug}>
                  {environment.name}{environment.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-muted">{profile.providerType === "infisical" ? "Infisical" : "GroundControl Vault"}</span>
        </div>

        {createOpen && (
          <div className="mt-4 grid gap-2 border border-border bg-background/40 p-3 sm:grid-cols-[minmax(180px,1fr)_auto]">
            <input
              value={environmentName}
              onChange={(event) => setEnvironmentName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void createEnvironment(); }}
              placeholder="Staging"
              className="gc-field gc-field--compact"
              autoFocus
            />
            <ActionButton primary onClick={() => void createEnvironment()} disabled={Boolean(busy) || !environmentName.trim()} icon={Plus}>Create</ActionButton>
          </div>
        )}
      </div>

      {notice && (
        <Notice className="mx-4 mt-4 md:mx-5" tone={notice.tone === "error" ? "danger" : notice.tone}>{notice.text}</Notice>
      )}

      {providerError && (
        <Notice className="mx-4 mt-4 md:mx-5" tone="danger" title="Infisical connection failed">{providerError}</Notice>
      )}

      <div className={`grid ${fixedScope ? "" : "md:grid-cols-[190px_minmax(0,1fr)]"}`}>
        {!fixedScope && (
          <aside className="border-b border-border bg-background/25 p-3 md:border-b-0 md:border-r">
            <div className="px-2 pb-2 text-[10px] font-medium text-muted">Scope</div>
            <ScopeButton
              active={selectedComponent === ""}
              label="Deployment-wide"
              count={Object.keys(profile?.values || {}).length}
              missingCount={[...missingKeys].filter((key) => !key.includes(":")).length}
              onClick={() => setSelectedComponent("")}
            />
            <div className="px-2 py-1 text-[10px] font-medium text-muted">Components</div>
            {components.map((component) => (
              <ScopeButton
                key={component}
                active={selectedComponent === component}
                label={component}
                count={Object.keys(profile.componentValues?.[component] || {}).length}
                missingCount={[...missingKeys].filter((key) => key.startsWith(`${component}:`)).length}
                onClick={() => setSelectedComponent(component)}
              />
            ))}
            {components.length === 0 && (
              <div className="px-2 py-3 text-[11px] leading-4 text-muted">No deployment components are available.</div>
            )}
          </aside>
        )}

        <div className="min-w-0 p-4 md:p-5">
          <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-accent" />
                <h4 className="text-sm font-medium">{scopeLabel}</h4>
              </div>
              <p className="mt-1 text-[11px] text-muted">{keys.length} secret{keys.length === 1 ? "" : "s"} in {profile.name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedComponent && keys.length > 0 && (
                <a href={exportHref} className="gc-button gc-button-quiet" title={`Download ${scopeLabel} secrets from ${profile.name}`}>
                  <Download className="h-3.5 w-3.5" /> Pull env file
                </a>
              )}
              <ActionButton
                primary
                onClick={() => void saveEnvironment({ values: Object.fromEntries([...dirtyKeys].map((key) => [key, draft[key] || ""])) })}
                disabled={Boolean(busy) || !hasPendingChanges}
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
                    if (!saved) return;
                    const result = await onRedeploy(selectedComponent || undefined, profile.slug);
                    if (result && !result.success && result.missingEnvKeys?.length) {
                      setMissingKeys(new Set(result.missingEnvKeys));
                      const first = result.missingEnvKeys[0];
                      const separator = first.indexOf(":");
                      if (separator > 0) setSelectedComponent(first.slice(0, separator));
                      const missingList = result.missingEnvKeys
                        .map((k: string) => { const s = k.indexOf(":"); return s > 0 ? `${k.slice(0, s)}:${k.slice(s + 1)}` : k; })
                        .join(", ");
                      setNotice({ tone: "error", text: `Missing secrets: ${missingList}. Fill them in or mark as optional to proceed.` });
                    }
                  }}
                  disabled={Boolean(busy)}
                  icon={ChevronRight}
                >
                  Deploy
                </ActionButton>
              )}
            </div>
          </div>

          {profile.providerType === "local" && (
            <div className="flex flex-wrap gap-2 py-4">
              <ActionButton onClick={() => { setAddOpen((open) => !open); setImportOpen(false); }} disabled={Boolean(busy)} icon={Plus}>Add secret</ActionButton>
              <ActionButton onClick={() => { setImportOpen((open) => !open); setAddOpen(false); }} disabled={Boolean(busy)} icon={FileUp}>Import env file</ActionButton>
            </div>
          )}

          {addOpen && profile.providerType === "local" && (
            <div className="mb-4 grid gap-2 border border-border bg-background/35 p-3 sm:grid-cols-[minmax(140px,.8fr)_minmax(180px,1fr)_auto]">
              <input
                value={newKey}
                onChange={(event) => setNewKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                placeholder="SECRET_NAME"
                className="gc-field gc-field--compact font-mono"
                autoFocus
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
                disabled={Boolean(busy) || !newKey || !newValue}
                onClick={async () => {
                  const key = newKey;
                  const ok = await saveEnvironment({
                    values: { [key]: newValue },
                    schema: schemaWith([key]),
                    success: `${key} added to ${scopeLabel} in ${profile.name}.`,
                  });
                  if (ok) {
                    setNewKey("");
                    setNewValue("");
                    setAddOpen(false);
                  }
                }}
                icon={Check}
              >
                Add
              </ActionButton>
            </div>
          )}

          {importOpen && profile.providerType === "local" && (
            <div className="mb-4 border border-border bg-background/35 p-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center border border-dashed border-border px-4 py-5 text-center hover:border-accent/50">
                  <FileUp className="h-5 w-5 text-muted" />
                  <span className="mt-2 text-xs">Choose an env file</span>
                  <span className="mt-1 text-[10px] text-muted">Its values are staged locally until you save.</span>
                  <input
                    type="file"
                    accept=".env,text/plain"
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file) stageImportedValues(await file.text());
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <div>
                  <textarea
                    value={pastedEnv}
                    onChange={(event) => setPastedEnv(event.target.value)}
                    placeholder={"Or paste values\nDATABASE_URL=…\nAPI_TOKEN=…"}
                    rows={5}
                    className="gc-field h-full min-h-28 w-full resize-y font-mono"
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <ActionButton disabled={!pastedEnv.trim()} onClick={() => stageImportedValues(pastedEnv)}>Stage pasted values</ActionButton>
              </div>
            </div>
          )}

          <div className="overflow-hidden border border-border">
            <div className="grid grid-cols-[minmax(150px,.8fr)_minmax(180px,1.2fr)] gap-3 bg-background/60 px-3 py-2 text-[10px] text-muted">
              <span>Name</span>
              <span>Value</span>
            </div>
            {keys.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <KeyRound className="mx-auto h-5 w-5 text-muted" />
                <div className="mt-3 text-sm">No secrets yet</div>
                <p className="mt-1 text-xs text-muted">Add a secret or import an env file for this component.</p>
              </div>
            ) : keys.map((key) => {
              const required = selectedSchema.find((entry) => entry.key === key)?.required;
              const isMissing = missingKeys.has(`${selectedComponent}:${key}`);
              return (
                <div key={key} className={`grid grid-cols-[minmax(150px,.8fr)_minmax(180px,1.2fr)] items-center gap-3 border-t px-3 py-3 ${isMissing ? "border-error/50 bg-error/5" : "border-border"}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className={`truncate ${isMissing ? "text-error" : ""}`}>{key}</span>
                      {required && <span className="text-accent" title="Required">*</span>}
                      {dirtyKeys.has(key) && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Unsaved" />}
                    </div>
                    {isMissing && <div className="mt-1 text-[10px] text-error">Required value missing</div>}
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <input
                      type="password"
                      value={dirtyKeys.has(key) ? draft[key] || "" : ""}
                      placeholder={selectedSavedValues[key]?.masked || "Set value"}
                      disabled={profile.providerType === "infisical"}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, [key]: event.target.value }));
                        setDirtyKeys((current) => new Set(current).add(key));
                      }}
                      aria-label={`Value for ${key} in ${scopeLabel}`}
                      aria-invalid={isMissing}
                      className={`gc-field gc-field--compact min-w-0 flex-1 font-mono ${isMissing ? "border-error ring-1 ring-error/30" : ""}`}
                    />
                    {profile.providerType === "local" && (
                      <button
                        type="button"
                        onClick={() => void deleteEnvironmentKey(key)}
                        disabled={Boolean(busy)}
                        className={`gc-icon-button ${deleteTarget === key ? "border-error/60 bg-error/10 text-error" : ""}`}
                        aria-label={`${deleteTarget === key ? "Confirm deletion of" : "Delete"} ${key}`}
                        title={deleteTarget === key ? "Select again to confirm" : "Delete secret"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <details className="mt-4 border border-border">
            <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium hover:bg-background/40">
              Secret provider
            </summary>
            <div className="grid gap-3 border-t border-border p-4 md:grid-cols-4">
              <label className="block">
                <span className="gc-label">Provider</span>
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
                    <option value="">Choose a project</option>
                    {infisicalProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
              ) : profile.providerType === "infisical" ? (
                <Field label="Project" value={profile.projectRef} onChange={(value) => setProfile({ ...profile, projectRef: value })} />
              ) : null}
              {profile.providerType === "infisical" && selectedInfisicalProject?.environments.length ? (
                <label className="block">
                  <span className="gc-label">Environment</span>
                  <select value={profile.environment} onChange={(event) => setProfile({ ...profile, environment: event.target.value })} className="gc-field w-full">
                    {selectedInfisicalProject.environments.map((environment) => (
                      <option key={environment.slug} value={environment.slug}>{environment.name}</option>
                    ))}
                  </select>
                </label>
              ) : profile.providerType === "infisical" ? (
                <Field label="Environment" value={profile.environment} onChange={(value) => setProfile({ ...profile, environment: value })} />
              ) : null}
              {profile.providerType === "infisical" && (
                <Field label="Path" value={profile.secretPath} onChange={(value) => setProfile({ ...profile, secretPath: value })} />
              )}
              <div className="flex flex-wrap justify-end gap-2 md:col-span-4">
                {!profile.isDefault && (
                  <ActionButton onClick={() => void saveEnvironment({ isDefault: true, success: `${profile.name} is now the default environment.` })} disabled={Boolean(busy)}>Make default</ActionButton>
                )}
                <ActionButton onClick={() => void saveEnvironment()} disabled={Boolean(busy)} icon={Save}>Save provider</ActionButton>
              </div>
            </div>
          </details>
        </div>
      </div>
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

function ScopeButton({ active, label, count, missingCount, onClick }: {
  active: boolean;
  label: string;
  count: number;
  missingCount: number;
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
        <span className="mt-0.5 block text-[10px] opacity-70">{count} secret{count === 1 ? "" : "s"}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {missingCount > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-error px-1.5 py-0.5 text-[9px] text-white">{missingCount}</span>}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </button>
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
      className={`gc-button ${primary ? "gc-button-primary" : success ? "border-success/40 bg-success/10 text-success hover:bg-success/15" : "gc-button-secondary"} ${props.className || ""}`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="gc-label">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="gc-field w-full" />
    </label>
  );
}
