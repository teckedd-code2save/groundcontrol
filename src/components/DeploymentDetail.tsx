"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ExternalLink,
  FolderGit2,
  Layers3,
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
  envProfile?: { status: string; lastSyncedAt?: string | null } | null;
  runtime?: {
    status: string;
    confidence: string;
    composeProject?: string | null;
    containers: Array<{ name: string; image: string; status: string; ports: string; state: string; service?: string | null }>;
    evidence: string[];
  };
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

  async function redeploy(component?: string) {
    if (!deployment?.legacyProjectSlug) return;
    setBusy(true);
    setMessage({ tone: "info", text: component ? `Redeploying ${component}…` : "Redeploying the deployment…" });
    try {
      const response = await fetch("/api/projects/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug: deployment.legacyProjectSlug,
          action: "redeploy",
          services: component ? [component] : undefined,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error || data.success === false) throw new Error(data.error || "Redeploy failed");
      setMessage({ tone: "success", text: component ? `${component} redeployed.` : "Deployment redeployed." });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const liveUrl = useMemo(() => {
    if (!deployment) return null;
    return deployment.publicUrl || (deployment.domain ? `https://${deployment.domain}` : null);
  }, [deployment]);

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
    { id: "environment", label: "Environment", detail: deployment.envProfile?.status || "Not configured" },
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
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${deployment.observedStatus === "present" ? "bg-success" : "bg-warning"}`} />
              <span className="gc-eyebrow">{deployment.observedStatus === "present" ? "Observed on host" : "Needs attention"}</span>
            </div>
            <h1 className="mt-3 truncate text-3xl font-semibold tracking-[-0.04em] md:text-4xl">{deployment.name}</h1>
            <p className="mt-2 font-mono text-[11px] text-muted">{deployment.kind} · {deployment.managementMode} · {deployment.slug}</p>
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
              <section className="gc-work-surface">
                <div className="border-b border-border px-5 py-4">
                  <p className="gc-eyebrow">Operational identity</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight">Where this deployment lives</h2>
                </div>
                <dl className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
                  <DetailValue label="Source path" value={deployment.sourcePath || "No source folder"} mono />
                  <DetailValue label="Runtime identity" value={deployment.containerName || deployment.composePath || "Resolved from deployment source"} mono />
                </dl>
              </section>

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

              <section className="border border-border bg-card">
                <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="gc-eyebrow">Runtime relationship</p>
                    <h2 className="mt-1 text-base font-medium">Containers linked to this deployment</h2>
                  </div>
                  <span className="font-mono text-[9px] uppercase text-muted">{deployment.runtime?.confidence || "none"} match</span>
                </div>
                {deployment.runtime?.containers.length ? (
                  <div className="divide-y divide-border">
                    {deployment.runtime.containers.map((container) => (
                      <div key={container.name} className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs text-foreground">{container.service || container.name}</p>
                          <p className="mt-1 truncate font-mono text-[9px] text-muted">{container.name} · {container.image}</p>
                        </div>
                        <span className={`font-mono text-[10px] ${container.state === "running" ? "text-success" : "text-warning"}`}>{container.state}</span>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2 px-5 py-3">
                      {deployment.runtime.evidence.map((item) => <span key={item} className="border border-border px-2 py-1 font-mono text-[9px] text-muted">{item}</span>)}
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-5 text-xs leading-relaxed text-muted">No running container could be linked from Docker Compose labels or the saved runtime identity. The deployment remains tracked, but its runtime needs reconciliation.</div>
                )}
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
              <DeploymentEnvPanel projectId={deployment.legacyProjectId} onRedeploy={(component) => void redeploy(component)} />
            ) : (
              <div className="border border-border bg-card p-6 text-sm text-muted">This standalone runtime has no saved deployment source yet, so environment reconciliation is not available.</div>
            )
          )}

          {tab === "releases" && (
            <section className="border border-border bg-card">
              <div className="border-b border-border px-5 py-4">
                <p className="gc-eyebrow">Change history</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">Recent releases</h2>
              </div>
              {deployment.releases.length === 0 ? (
                <div className="p-6 text-sm text-muted">This workload exists on the host, but GroundControl did not capture its earlier release history. Runtime evidence above is current; future deploys will add release records here.</div>
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
    </div>
  );
}

function DetailValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <dt className="gc-label">{label}</dt>
      <dd className={`mt-2 break-all text-xs text-foreground/85 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function ManagementLink({ icon, title, detail, href, onClick }: { icon: React.ReactNode; title: string; detail: string; href?: string; onClick?: () => void }) {
  const content = <><span className="mt-0.5 text-muted">{icon}</span><span><span className="block text-xs font-medium">{title}</span><span className="mt-0.5 block text-[10px] text-muted">{detail}</span></span></>;
  const className = "flex min-h-16 items-start gap-3 border border-border bg-background/40 p-3 text-left transition-colors hover:border-accent/40 hover:bg-background";
  if (href) return <Link href={href} className={className}>{content}</Link>;
  return <button type="button" onClick={onClick} className={className}>{content}</button>;
}
