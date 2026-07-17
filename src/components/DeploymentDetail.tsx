"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Box,
  Code2,
  ExternalLink,
  FolderGit2,
  Layers3,
  Pencil,
  RefreshCw,
  ServerCog,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import { DeploymentEnvPanel } from "@/components/DeploymentEnvPanel";
import { ModalSurface } from "@/components/ModalSurface";

type Group = { id: number; name: string; slug: string; description: string };
type Release = {
  id: number;
  status: string;
  branch: string;
  commitSha?: string | null;
  publicUrl?: string | null;
  previewUrl?: string | null;
  durationMs?: number | null;
  createdAt: string;
  target?: { name: string; type: string } | null;
  imageDigest?: string | null;
  previousImageDigest?: string | null;
  changedFields?: string | null;
};
type ContainerInfo = {
  name: string;
  image: string;
  state: string;
  status: string;
};
type DeploymentDetailRecord = {
  id: number;
  name: string;
  slug: string;
  kind: string;
  managementMode: string;
  sourcePath?: string | null;
  composePath?: string | null;
  containerName?: string | null;
  status: string;
  observedStatus: string;
  projectId?: number | null;
  project?: Group | null;
  legacyProjectId?: number | null;
  legacyProjectSlug?: string | null;
  repoUrl?: string | null;
  domain?: string | null;
  publicUrl?: string | null;
  releases: Release[];
  envProfile?: {
    id: number;
    name: string;
    slug: string;
    providerType: string;
    environment: string;
    status: string;
  } | null;
  runtime?: {
    status: string;
    composeProject?: string | null;
    containers?: ContainerInfo[];
  } | null;
  runtimeEvents?: Array<{
    id: number;
    status: string;
    output?: string | null;
    error?: string | null;
    createdAt: string;
  }>;
  imageDigest?: string | null;
  previousImageDigest?: string | null;
  identitySource?: string;
};

type Tab = "manage" | "environment" | "releases";

async function readJson(response: Response) {
  try { return await response.json(); } catch { return {}; }
}

export default function DeploymentDetail({
  slug,
  initialTab,
}: {
  slug: string;
  initialTab?: string;
}) {
  const [deployment, setDeployment] = useState<DeploymentDetailRecord | null>(null);
  const [projects, setProjects] = useState<Group[]>([]);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("manage");
  const [projectOpen, setProjectOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [publicUrlInput, setPublicUrlInput] = useState("");
  const [repoUrlInput, setRepoUrlInput] = useState("");
  const [composeContent, setComposeContent] = useState("");
  const [composeLoading, setComposeLoading] = useState(false);
  const [imageSourceInput, setImageSourceInput] = useState("");
  const [imageDigestInput, setImageDigestInput] = useState("");
  const [redeployLog, setRedeployLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deployment-inventory/${encodeURIComponent(slug)}`);
      const data = await readJson(res);
      if (!res.ok || data.error) {
        setMessage({ tone: "error", text: data.error || "Could not load deployment" });
        return;
      }
      setDeployment(data.deployment);
      setProjects(Array.isArray(data.projects) ? data.projects : []);
      setContainers(Array.isArray(data.deployment?.runtime?.containers) ? data.deployment.runtime.containers : []);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const resolved = initialTab === "environment" || initialTab === "releases" ? initialTab as Tab : "manage";
    setTab(resolved);
  }, [initialTab]);

  async function assignProject(projectGroupId: number | null) {
    if (!deployment) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${deployment.id}/group`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectGroupId }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not update project");
      await load();
      setProjectOpen(false);
      setMessage({ tone: "success", text: projectGroupId ? "Deployment linked to project." : "Deployment moved to Ungrouped." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function redeploy(component?: string, environmentSlug?: string) {
    if (!deployment?.legacyProjectSlug) return { success: false };
    setBusy(true);
    setMessage({ tone: "info", text: component ? `Redeploying ${component}…` : "Redeploying the deployment…" });
    try {
      const response = await fetch("/api/projects/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug: deployment.legacyProjectSlug,
          projectPath: deployment.sourcePath || undefined,
          action: "redeploy",
          services: component ? [component] : undefined,
          environmentSlug,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error || data.success === false) {
        const missingEnvKeys = Array.isArray(data.missingEnvKeys)
          ? data.missingEnvKeys.filter((key: unknown): key is string => typeof key === "string")
          : [];
        setMessage({
          tone: "error",
          text: missingEnvKeys.length
            ? `Missing secrets: ${missingEnvKeys.map((k: string) => { const s = k.indexOf(":"); return s > 0 ? k.slice(s + 1) : k; }).join(", ")}`
            : data.error || "Redeploy failed",
        });
        return { success: false, missingEnvKeys };
      }

      if (data.detached) {
        setMessage({ tone: "info", text: "Redeploy queued — checking status…" });
        setShowLog(true);
        setRedeployLog([]);
        setBusy(true);

        // Poll logs every 2 seconds
        const logInterval = setInterval(async () => {
          try {
            const logRes = await fetch(`/api/projects/compose/log?slug=${encodeURIComponent(deployment.legacyProjectSlug!)}`);
            if (logRes.ok) {
              const logData = await readJson(logRes);
              if (Array.isArray(logData.lines)) setRedeployLog(logData.lines);
            }
          } catch { /* log polling is best-effort */ }
        }, 2000);

        const changed = data.changedFields as string[] | undefined;
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const healthRes = await fetch("/api/projects/compose", { signal: AbortSignal.timeout(5000) });
            if (healthRes.ok) {
              clearInterval(logInterval);
              // Final log fetch
              try {
                const logRes = await fetch(`/api/projects/compose/log?slug=${encodeURIComponent(deployment.legacyProjectSlug!)}`);
                if (logRes.ok) { const logData = await readJson(logRes); if (Array.isArray(logData.lines)) setRedeployLog(logData.lines); }
              } catch {}
              setMessage({
                tone: "success",
                text: component
                  ? `${component} redeployed${changed?.length ? ` (${changed.join(", ")})` : ""}.`
                  : `Deployment redeployed${changed?.length ? ` (${changed.join(", ")})` : ""}.`,
              });
              setTimeout(() => setShowLog(false), 5000);
              setBusy(false);
              await load();
              return { success: true };
            }
          } catch { /* expected during restart */ }
          if (attempt === 4) setMessage({ tone: "info", text: "Still waiting…" });
        }
        clearInterval(logInterval);
        setMessage({ tone: "info", text: "Redeploy may have completed — refresh to confirm." });
        setTimeout(() => setShowLog(false), 10000);
        setBusy(false);
        await load();
        return { success: true };
      }

      setMessage({ tone: "success", text: component ? `${component} redeployed.` : "Deployment redeployed." });
      await load();
      return { success: true };
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return { success: false };
    } finally {
      setBusy(false);
    }
  }

  function openIdentityEditor() {
    setPublicUrlInput(liveUrl || "");
    setRepoUrlInput(deployment?.repoUrl || "");
    setIdentityOpen(true);
  }

  async function saveIdentity() {
    if (!deployment) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/deployment-inventory/${encodeURIComponent(deployment.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicUrl: publicUrlInput, repoUrl: repoUrlInput }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not save deployment identity");
      await load();
      setIdentityOpen(false);
      setMessage({ tone: "success", text: "Deployment identity saved." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function openComposeViewer() {
    if (!deployment?.legacyProjectSlug) return;
    setComposeLoading(true);
    setComposeOpen(true);
    try {
      const res = await fetch(`/api/projects/compose?slug=${encodeURIComponent(deployment.legacyProjectSlug)}`);
      const data = await readJson(res);
      setComposeContent(data.raw || "No compose file found.");
    } catch {
      setComposeContent("Failed to load compose file.");
    } finally {
      setComposeLoading(false);
    }
  }

  function openImageEditor(container: ContainerInfo) {
    setImageSourceInput(container.image);
    setImageDigestInput("");
    setImageEditorOpen(true);
  }

  async function saveImageSource() {
    setImageEditorOpen(false);
    setMessage({ tone: "info", text: "Image source editing via compose file requires deploy integration. Use the Compose viewer to edit the docker-compose.yml directly." });
  }

  const liveUrl = deployment?.publicUrl || (deployment?.domain ? `https://${deployment.domain}` : null);
  const changedFields = deployment?.releases[0]?.changedFields
    ? (() => { try { return JSON.parse(deployment.releases[0].changedFields) as string[]; } catch { return []; } })()
    : [];

  if (loading && !deployment) {
    return <div className="mx-auto max-w-7xl p-4 text-sm text-muted md:p-8">Loading deployment workspace…</div>;
  }

  if (!deployment) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Link href="/deployments" className="gc-button gc-button-quiet"><ArrowLeft size={14} />Deployments</Link>
        <div className="mt-6 border border-error/30 bg-error/5 p-5 text-sm text-error">{message?.text || "Deployment not found."}</div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; detail: string }[] = [
    { id: "manage", label: "Manage", detail: "Containers, sources, configuration" },
    { id: "environment", label: "Environment", detail: deployment.envProfile?.name || "Configure" },
    { id: "releases", label: "Releases", detail: `${deployment.releases.length} recent` },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <Link href="/deployments" className="mb-6 inline-flex items-center gap-2 text-xs text-muted hover:text-foreground">
        <ArrowLeft size={14} aria-hidden="true" />
        Deployments
      </Link>

      <header className="border-b border-border pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold tracking-[-0.04em] md:text-4xl">{deployment.name}</h1>
            <p className={`mt-2 text-xs ${deployment.observedStatus === "present" ? "text-muted" : "text-warning"}`}>
              {deployment.observedStatus === "present" ? deployment.project?.name || "Ungrouped" : "Needs attention"}
              {deployment.identitySource === "manual" && " · manually confirmed"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {deployment.kind === "compose" && deployment.legacyProjectSlug && (
              <button type="button" disabled={busy} onClick={() => void redeploy()} className="gc-button gc-button-secondary">
                <RefreshCw size={14} aria-hidden="true" />
                {busy ? "Working…" : "Redeploy"}
              </button>
            )}
            {deployment.repoUrl && (
              <a href={deployment.repoUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-secondary">
                <FolderGit2 size={14} aria-hidden="true" />
                Repository
              </a>
            )}
            <button type="button" onClick={openIdentityEditor} className="gc-button gc-button-secondary">
              <Pencil size={14} aria-hidden="true" />
              Edit identity
            </button>
            {liveUrl && (
              <a href={liveUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-primary">
                <ExternalLink size={14} aria-hidden="true" />
                Open live
              </a>
            )}
          </div>
        </div>
      </header>

      {message && (
        <div className={`mt-5 border px-3 py-2 text-xs ${
          message.tone === "success"
            ? "border-success/30 bg-success/10 text-success"
            : message.tone === "error"
              ? "border-error/30 bg-error/10 text-error"
              : "border-border bg-card text-muted"
        }`}>{message.text}</div>
      )}

      {showLog && redeployLog.length > 0 && (
        <div className="mt-3 border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[10px] font-mono text-muted">Redeploy log</span>
            <button onClick={() => setShowLog(false)} className="text-[10px] font-mono text-muted hover:text-foreground">Hide</button>
          </div>
          <pre className="max-h-48 overflow-auto p-3 font-mono text-[10px] leading-relaxed text-muted whitespace-pre-wrap">
            {redeployLog.join("\n")}
          </pre>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Deployment sections" className="h-fit border border-border bg-card p-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`w-full border-l-2 px-3 py-2.5 text-left transition-colors ${
                tab === item.id ? "border-accent bg-background text-foreground" : "border-transparent text-muted hover:bg-background/60 hover:text-foreground"
              }`}
            >
              <span className="block text-xs font-medium">{item.label}</span>
              <span className="mt-0.5 block truncate font-mono text-[9px] text-muted">{item.detail}</span>
            </button>
          ))}
        </nav>

        <main className="min-w-0">
          {/* ===== MANAGE TAB ===== */}
          {tab === "manage" && (
            <div className="space-y-6">
              {/* Identity + Access cards */}
              <section className="grid gap-4 lg:grid-cols-2">
                <div className="border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="gc-eyebrow">Project</p>
                      <h2 className="mt-2 text-base font-medium">{deployment.project?.name || "Ungrouped"}</h2>
                      <p className="mt-1 text-xs leading-relaxed text-muted">Projects organize related deployments.</p>
                    </div>
                    <Layers3 size={18} className="text-muted" aria-hidden="true" />
                  </div>
                  <div className="mt-5 flex gap-2">
                    <button type="button" onClick={() => setProjectOpen(true)} className="gc-button gc-button-secondary">Change project</button>
                    <Link href="/projects" className="gc-button gc-button-quiet">Open projects</Link>
                  </div>
                </div>

                <div className="border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="gc-eyebrow">Access</p>
                      <h2 className="mt-2 text-base font-medium">Endpoints and source</h2>
                      <p className="mt-1 text-xs leading-relaxed text-muted">Customer-facing route and repository.</p>
                    </div>
                    <ExternalLink size={18} className="text-muted" aria-hidden="true" />
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {liveUrl ? <a href={liveUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-secondary">Open live</a> : <span className="text-xs text-muted">No public endpoint recorded.</span>}
                    {deployment.repoUrl && <a href={deployment.repoUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-quiet">Repository</a>}
                  </div>
                </div>
              </section>

              {/* Management quick-actions — fixed titles */}
              <section className="border border-border bg-card p-5">
                <p className="gc-eyebrow">Management</p>
                <h2 className="mt-2 text-base font-medium">Manage deployment</h2>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <ManagementLink icon={<Box size={16} />} onClick={() => {}} title="Containers" detail="Running services below" />
                  <ManagementLink icon={<Settings2 size={16} />} onClick={() => setTab("environment")} title="Environment" detail="Configuration and secrets" />
                  <ManagementLink icon={<Activity size={16} />} onClick={() => setTab("releases")} title="Releases" detail="Changes and outcomes" />
                  <ManagementLink icon={<ServerCog size={16} />} href="/intelligence" title="Intelligence" detail="Evidence and investigation" />
                </div>
              </section>

              {/* Compose viewer + image info */}
              {deployment.kind === "compose" && (
                <section className="border border-border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="gc-eyebrow">Compose</p>
                      <h2 className="mt-1 text-base font-medium">Deployment configuration</h2>
                    </div>
                    <button type="button" onClick={openComposeViewer} className="gc-button gc-button-secondary">
                      <Code2 size={14} aria-hidden="true" />
                      View compose
                    </button>
                  </div>
                  {deployment.imageDigest && (
                    <p className="mt-3 font-mono text-[10px] text-muted truncate">
                      Current image: {deployment.imageDigest.slice(0, 47)}…
                    </p>
                  )}
                  {changedFields.length > 0 && (
                    <p className="mt-1 font-mono text-[10px] text-accent">
                      Last change: {changedFields.join(", ")}
                    </p>
                  )}
                </section>
              )}

              {/* Containers list */}
              {containers.length > 0 && (
                <section className="border border-border bg-card">
                  <div className="border-b border-border px-5 py-4">
                    <p className="gc-eyebrow">Runtime</p>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight">Containers ({containers.length})</h2>
                  </div>
                  <div className="divide-y divide-border">
                    {containers.map((container) => (
                      <div key={container.name} className="flex items-center justify-between gap-4 px-5 py-3">
                        <div className="min-w-0">
                          <span className="block truncate font-mono text-sm">{container.name}</span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted">{container.image}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                            container.state === "running" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                          }`}>{container.state}</span>
                          <button
                            type="button"
                            onClick={() => openImageEditor(container)}
                            className="rounded px-2 py-1 font-mono text-[10px] text-muted hover:bg-background hover:text-foreground transition-colors"
                            title="View image source"
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Runtime events */}
              {Boolean(deployment.runtimeEvents?.length) && (
                <section className="border border-border bg-card">
                  <div className="border-b border-border px-5 py-4">
                    <p className="gc-eyebrow">Recent actions</p>
                  </div>
                  <div className="divide-y divide-border max-h-96 overflow-auto">
                    {deployment.runtimeEvents!.map((event) => (
                      <RuntimeEvent key={event.id} event={event} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ===== ENVIRONMENT TAB ===== */}
          {tab === "environment" && (
            deployment.legacyProjectId ? (
              <DeploymentEnvPanel projectId={deployment.legacyProjectId} onRedeploy={redeploy} />
            ) : (
              <div className="border border-border bg-card p-6 text-sm text-muted">Connect this deployment to a saved source before configuring environments.</div>
            )
          )}

          {/* ===== RELEASES TAB ===== */}
          {tab === "releases" && (
            <section className="border border-border bg-card">
              <div className="border-b border-border px-5 py-4">
                <p className="gc-eyebrow">Change history</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">Recent releases</h2>
              </div>
              {deployment.releases.length === 0 ? (
                <div className="p-6 text-sm text-muted">No releases recorded. Redeploy to create a release record with image digest and change tracking.</div>
              ) : (
                <div className="divide-y divide-border">
                  {deployment.releases.map((release) => (
                    <div key={release.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{release.target?.name || release.target?.type || "Deployment"}</span>
                          <span className="border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted">{release.status}</span>
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-muted">
                          {release.commitSha?.slice(0, 10) || release.branch || "No commit recorded"}
                        </p>
                        {release.imageDigest && (
                          <p className="mt-0.5 font-mono text-[9px] text-muted truncate">
                            {release.imageDigest.slice(0, 55)}…
                          </p>
                        )}
                        {release.changedFields && (() => {
                          try {
                            const fields = JSON.parse(release.changedFields) as string[];
                            return fields.length > 0 ? (
                              <span className="mt-1 inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] text-accent">
                                {fields.join(", ")}
                              </span>
                            ) : null;
                          } catch { return null; }
                        })()}
                      </div>
                      <span className="font-mono text-[10px] text-muted">{new Date(release.createdAt).toLocaleString()}</span>
                      {(release.publicUrl || release.previewUrl) && (
                        <a href={release.publicUrl || release.previewUrl || "#"} target="_blank" rel="noreferrer" className="gc-icon-button" aria-label="Open release URL">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* ===== MODALS ===== */}

      <ModalSurface open={projectOpen} onClose={() => setProjectOpen(false)} title="Change project">
        <div className="space-y-1">
          <button type="button" disabled={busy} onClick={() => void assignProject(null)} className="flex w-full items-center justify-between border border-border px-3 py-2.5 text-left text-sm hover:border-accent/50 hover:bg-card">
            <span>Ungrouped</span><span className="font-mono text-[10px] text-muted">No project</span>
          </button>
          {projects.map((project) => (
            <button key={project.id} type="button" disabled={busy} onClick={() => void assignProject(project.id)} className="flex w-full items-center justify-between border border-border px-3 py-2.5 text-left text-sm hover:border-accent/50 hover:bg-card">
              <span>{project.name}</span><span className="font-mono text-[10px] text-muted">{project.slug}</span>
            </button>
          ))}
        </div>
      </ModalSurface>

      <ModalSurface open={identityOpen} onClose={() => setIdentityOpen(false)} title="Deployment identity" description="Confirm values GroundControl cannot safely infer.">
        <form onSubmit={(event) => { event.preventDefault(); void saveIdentity(); }} className="space-y-4">
          <label className="block">
            <span className="gc-label">Deployed URL</span>
            <input autoFocus value={publicUrlInput} onChange={(event) => setPublicUrlInput(event.target.value)} placeholder="https://app.example.com" className="gc-field mt-2 w-full font-mono" />
          </label>
          <label className="block">
            <span className="gc-label">GitHub repository</span>
            <input value={repoUrlInput} onChange={(event) => setRepoUrlInput(event.target.value)} placeholder="https://github.com/owner/repository" className="gc-field mt-2 w-full font-mono" />
          </label>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setIdentityOpen(false)} className="gc-button gc-button-quiet">Cancel</button>
            <button type="submit" disabled={busy} className="gc-button gc-button-primary">{busy ? "Saving…" : "Save identity"}</button>
          </div>
        </form>
      </ModalSurface>

      <ModalSurface open={composeOpen} onClose={() => { setComposeOpen(false); setComposeContent(""); }} title="Compose file" description={deployment.sourcePath || deployment.composePath || deployment.slug}>
        {composeLoading ? (
          <div className="py-8 text-center text-sm text-muted">Loading…</div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={composeContent}
              onChange={(event) => setComposeContent(event.target.value)}
              className="w-full max-h-[50vh] min-h-[20vh] resize-y overflow-auto rounded border border-border bg-background p-4 font-mono text-xs whitespace-pre-wrap focus:border-accent focus:outline-none"
              spellCheck={false}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted">Edit the compose file directly. Changes take effect on next redeploy.</span>
              <div className="flex gap-2">
                <button type="button" onClick={openComposeViewer} className="gc-button gc-button-quiet text-xs">Reset</button>
                <button type="button" onClick={async () => {
                  setMessage({ tone: "info", text: "Compose editing via API requires a save endpoint. Use the Terminal to edit files directly." });
                }} className="gc-button gc-button-secondary text-xs">Save changes</button>
              </div>
            </div>
          </div>
        )}
      </ModalSurface>

      <ModalSurface open={imageEditorOpen} onClose={() => setImageEditorOpen(false)} title="Image source" description="Edit the image used by this container in docker-compose.yml">
        <div className="space-y-4">
          <label className="block">
            <span className="gc-label">Image</span>
            <input value={imageSourceInput} onChange={(event) => setImageSourceInput(event.target.value)} className="gc-field mt-2 w-full font-mono text-xs" />
          </label>
          <label className="block">
            <span className="gc-label">Pin digest (optional)</span>
            <input value={imageDigestInput} onChange={(event) => setImageDigestInput(event.target.value)} placeholder="ghcr.io/owner/repo@sha256:abc123..." className="gc-field mt-2 w-full font-mono text-xs" />
          </label>
          <p className="text-[10px] text-muted">Use the Compose viewer to edit docker-compose.yml directly. Image source changes require a redeploy to take effect.</p>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setImageEditorOpen(false)} className="gc-button gc-button-quiet">Close</button>
          </div>
        </div>
      </ModalSurface>
    </div>
  );
}

function ManagementLink({ icon, title, detail, href, onClick }: { icon: React.ReactNode; title: string; detail: string; href?: string; onClick?: () => void }) {
  const content = <><span className="mt-0.5 text-muted">{icon}</span><span><span className="block text-xs font-medium">{title}</span><span className="mt-0.5 block text-[10px] text-muted">{detail}</span></span></>;
  const className = "flex min-h-16 items-start gap-3 border border-border bg-background/40 p-3 text-left transition-colors hover:border-accent/40 hover:bg-background";
  if (href) return <Link href={href} className={className}>{content}</Link>;
  return <button type="button" onClick={onClick} className={className}>{content}</button>;
}

function RuntimeEvent({ event }: { event: { id: number; status: string; output?: string | null; error?: string | null; createdAt: string } }) {
  const [expanded, setExpanded] = useState(false);
  const text = event.error || event.output || "Lifecycle action recorded";
  const hasDetail = text.length > 80;
  return (
    <div className="px-5 py-3 cursor-pointer hover:bg-background/50" onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium">Compose {event.status}</span>
          <p className={`mt-1 font-mono text-[9px] text-muted ${expanded ? "whitespace-pre-wrap break-all" : "line-clamp-2"}`}>{text}</p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {hasDetail && !expanded && <span className="mt-1 text-[10px] text-accent">Click to expand</span>}
    </div>
  );
}
