"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
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
  envProfile?: { name?: string; status: string; lastSyncedAt?: string | null } | null;
  runtime?: {
    status: string;
    confidence: string;
    composeProject?: string | null;
    containers: Array<{ name: string; image: string; status: string; ports: string; state: string; service?: string | null; createdAt?: string; startedAt?: string; restartCount?: number }>;
    evidence: string[];
  };
  route?: { file: string; domain: string; proxy?: string | null; root?: string | null; confidence: string; score: number } | null;
  identitySource?: string;
  runtimeEvents?: Array<{ id: number; status: string; output?: string | null; error?: string | null; durationMs?: number | null; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
};

type Tab = "overview" | "environment" | "releases";

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Invalid response" };
  }
}

export function DeploymentDetail({ slug }: { slug: string }) {
  const [deployment, setDeployment] = useState<DeploymentDetailRecord | null>(null);
  const [projects, setProjects] = useState<Group[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [publicUrlInput, setPublicUrlInput] = useState("");
  const [repoUrlInput, setRepoUrlInput] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/deployment-inventory/${encodeURIComponent(slug)}`, { cache: "no-store" });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not load deployment");
      setDeployment(data.deployment);
      setProjects(data.projects || []);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

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
            ? "Redeploy failed: Missing required env keys for this redeploy"
            : data.error || "Redeploy failed",
        });
        return { success: false, missingEnvKeys };
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
      setMessage({ tone: "success", text: "Deployment URL and repository saved as operator-confirmed identity." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const liveUrl = deployment?.publicUrl || (deployment?.domain ? `https://${deployment.domain}` : null);

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
    { id: "overview", label: "Overview", detail: "Identity and access" },
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
          {tab === "overview" && (
            <div className="space-y-6">
              <section className="grid gap-4 lg:grid-cols-2">
                <div className="border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="gc-eyebrow">Project</p>
                      <h2 className="mt-2 text-base font-medium">{deployment.project?.name || "Ungrouped"}</h2>
                      <p className="mt-1 text-xs leading-relaxed text-muted">Projects organize related deployments without changing this runtime.</p>
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
                      <p className="mt-1 text-xs leading-relaxed text-muted">Open the customer-facing route or inspect the repository behind this deployment.</p>
                    </div>
                    <ExternalLink size={18} className="text-muted" aria-hidden="true" />
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {liveUrl ? <a href={liveUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-secondary">Open live</a> : <span className="text-xs text-muted">No public endpoint recorded.</span>}
                    {deployment.repoUrl && <a href={deployment.repoUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-quiet">Repository</a>}
                  </div>
                </div>
              </section>

              <section className="border border-border bg-card p-5">
                <p className="gc-eyebrow">Management</p>
                <h2 className="mt-2 text-base font-medium">Operate the whole deployment</h2>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <ManagementLink icon={<TerminalSquare size={16} />} href="/containers" title="Runtime" detail="Containers and processes" />
                  <ManagementLink icon={<Settings2 size={16} />} onClick={() => setTab("environment")} title="Environment" detail="Configuration and secrets" />
                  <ManagementLink icon={<Activity size={16} />} onClick={() => setTab("releases")} title="Releases" detail="Changes and outcomes" />
                  <ManagementLink icon={<ServerCog size={16} />} href="/intelligence" title="Intelligence" detail="Evidence and investigation" />
                </div>
              </section>
            </div>
          )}

          {tab === "environment" && (
            deployment.legacyProjectId ? (
              <DeploymentEnvPanel projectId={deployment.legacyProjectId} onRedeploy={redeploy} />
            ) : (
              <div className="border border-border bg-card p-6 text-sm text-muted">Connect this deployment to a saved source before configuring environments.</div>
            )
          )}

          {tab === "releases" && (
            <section className="border border-border bg-card">
              <div className="border-b border-border px-5 py-4">
                <p className="gc-eyebrow">Change history</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">Recent releases</h2>
              </div>
              {deployment.releases.length === 0 ? (
                <div className="p-6 text-sm text-muted">No release record was captured by the deployment pipeline. Host and runtime events below still provide operational history.</div>
              ) : (
                <div className="divide-y divide-border">
                  {deployment.releases.map((release) => (
                    <div key={release.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{release.target?.name || release.target?.type || "Deployment"}</span>
                          <span className="border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted">{release.status}</span>
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-muted">{release.commitSha?.slice(0, 10) || release.branch || "No commit recorded"}</p>
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
              {Boolean(deployment.runtimeEvents?.length) && (
                <div className="border-t border-border">
                  <div className="px-5 py-3"><p className="gc-eyebrow">Runtime deployment events</p></div>
                  <div className="divide-y divide-border">
                    {deployment.runtimeEvents!.map((event) => (
                      <div key={event.id} className="grid gap-2 px-5 py-3 md:grid-cols-[1fr_auto]">
                        <div>
                          <span className="text-xs font-medium">Compose redeploy</span>
                          <p className="mt-1 max-w-2xl truncate font-mono text-[9px] text-muted">{event.error || event.output || "Lifecycle action recorded"}</p>
                        </div>
                        <span className="font-mono text-[10px] text-muted">{event.status} · {new Date(event.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      <ModalSurface open={projectOpen} onClose={() => setProjectOpen(false)} title="Change project" description="Organization only—runtime and configuration remain attached to this deployment.">
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
      <ModalSurface open={identityOpen} onClose={() => setIdentityOpen(false)} title="Deployment identity" description="Confirm values GroundControl cannot safely infer. Host evidence remains visible and is not overwritten.">
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
    </div>
  );
}

function ManagementLink({ icon, title, detail, href, onClick }: { icon: React.ReactNode; title: string; detail: string; href?: string; onClick?: () => void }) {
  const content = <><span className="mt-0.5 text-muted">{icon}</span><span><span className="block text-xs font-medium">{title}</span><span className="mt-0.5 block text-[10px] text-muted">{detail}</span></span></>;
  const className = "flex min-h-16 items-start gap-3 border border-border bg-background/40 p-3 text-left transition-colors hover:border-accent/40 hover:bg-background";
  if (href) return <Link href={href} className={className}>{content}</Link>;
  return <button type="button" onClick={onClick} className={className}>{content}</button>;
}
