"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FolderGit2,
  Link2,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";
import {
  ContextActionMenu,
  ContextMenuAction,
  ContextMenuDivider,
  ContextMenuLabel,
} from "@/components/ContextActionMenu";
import { ModalSurface } from "@/components/ModalSurface";

type DeploymentSummary = {
  id: number;
  slug: string;
  name: string;
  path: string;
  domain: string | null;
  publicUrl?: string | null;
  repoUrl?: string | null;
  status: string;
  lastDeploy: string | null;
};

type ProjectGroup = {
  id: number;
  slug: string;
  name: string;
  description: string;
  deployments: DeploymentSummary[];
};

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Invalid response" };
  }
}

export function ProjectGroupsPanel() {
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [ungrouped, setUngrouped] = useState<DeploymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [linkProject, setLinkProject] = useState<ProjectGroup | null>(null);
  const [moveDeployment, setMoveDeployment] = useState<DeploymentSummary | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/project-groups", { cache: "no-store" });
    const data = await readJson(response);
    if (!response.ok || data.error) throw new Error(data.error || "Failed to load projects");
    setProjects(Array.isArray(data.projects) ? data.projects : []);
    setUngrouped(Array.isArray(data.ungrouped) ? data.ungrouped : []);
  }, []);

  useEffect(() => {
    void load()
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, [load]);

  const allDeployments = useMemo(
    () => [...ungrouped, ...projects.flatMap((project) => project.deployments)],
    [projects, ungrouped]
  );

  async function createProject() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/project-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not create project");
      setName("");
      setDescription("");
      setCreateOpen(false);
      setMessage("Project created.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function assignDeployment(deploymentId: number, projectGroupId: number | null) {
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${deploymentId}/group`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectGroupId }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not move deployment");
      setMessage(projectGroupId ? "Deployment linked to project." : "Deployment moved to Ungrouped.");
      setLinkProject(null);
      setMoveDeployment(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(projectId: number) {
    setBusy(true);
    try {
      const response = await fetch(`/api/project-groups/${projectId}`, { method: "DELETE" });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not delete project");
      setMessage("Project removed; its deployments are now ungrouped.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="border border-border bg-card p-6 text-sm text-muted">Loading projects…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="gc-eyebrow">Organization</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Projects</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Group deployments that belong together. Each deployment keeps its own runtime, source, environment, and release history.
          </p>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)} className="gc-button gc-button-primary">
          <Plus size={14} aria-hidden="true" />
          New project
        </button>
      </div>

      {message && <div className="border border-border bg-card px-3 py-2 text-xs text-muted">{message}</div>}

      <div className="space-y-4">
        {projects.map((project) => (
          <section id={project.slug} key={project.id} className="scroll-mt-6 border border-border bg-card">
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4">
              <div>
                <h2 className="text-base font-medium tracking-tight">{project.name}</h2>
                <p className="mt-1 text-xs text-muted">
                  {project.description || `${project.deployments.length} deployment${project.deployments.length === 1 ? "" : "s"}`}
                </p>
              </div>
              <ContextActionMenu label={`Actions for ${project.name}`}>
                {(close) => (
                  <>
                    <ContextMenuLabel>Project</ContextMenuLabel>
                    <ContextMenuAction onClick={() => {
                      close();
                      setLinkProject(project);
                    }}>
                      <Link2 size={14} aria-hidden="true" />
                      Add deployment
                    </ContextMenuAction>
                    <ContextMenuDivider />
                    <ContextMenuAction
                      tone="danger"
                      disabled={busy}
                      onClick={() => {
                        close();
                        void deleteProject(project.id);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      Delete project
                    </ContextMenuAction>
                  </>
                )}
              </ContextActionMenu>
            </div>
            <DeploymentRows
              deployments={project.deployments}
              activeProjectId={project.id}
              onMove={setMoveDeployment}
              onAssign={assignDeployment}
            />
          </section>
        ))}

        <section className="border border-dashed border-border bg-card/60">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4">
            <div>
              <h2 className="text-sm font-medium">Ungrouped deployments</h2>
              <p className="mt-1 text-xs text-muted">Deployments that have not been linked to a project.</p>
            </div>
          </div>
          <DeploymentRows
            deployments={ungrouped}
            activeProjectId={null}
            onMove={setMoveDeployment}
            onAssign={assignDeployment}
          />
        </section>
      </div>

      <ModalSurface
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create project"
        description="A project is an organizational group. You can link deployments after creating it."
      >
        <form onSubmit={(event) => {
          event.preventDefault();
          void createProject();
        }} className="space-y-4">
          <label className="block">
            <span className="gc-label">Project name</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer platform" className="gc-field mt-2 w-full" />
          </label>
          <label className="block">
            <span className="gc-label">Description <span className="normal-case tracking-normal text-muted/70">optional</span></span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What these deployments deliver together" rows={3} className="gc-field mt-2 w-full resize-none" />
          </label>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setCreateOpen(false)} className="gc-button gc-button-quiet">Cancel</button>
            <button type="submit" disabled={!name.trim() || busy} className="gc-button gc-button-primary">{busy ? "Creating…" : "Create project"}</button>
          </div>
        </form>
      </ModalSurface>

      <ModalSurface
        open={Boolean(linkProject)}
        onClose={() => setLinkProject(null)}
        title={linkProject ? `Add deployment to ${linkProject.name}` : "Add deployment"}
        description="Choose an existing deployment. Its runtime and configuration will not move."
      >
        <div className="space-y-1">
          {allDeployments.filter((deployment) => !linkProject?.deployments.some((item) => item.id === deployment.id)).length === 0 ? (
            <p className="border border-dashed border-border p-4 text-sm text-muted">Every deployment is already in this project.</p>
          ) : allDeployments
            .filter((deployment) => !linkProject?.deployments.some((item) => item.id === deployment.id))
            .map((deployment) => (
              <button
                key={deployment.id}
                type="button"
                disabled={busy}
                onClick={() => void assignDeployment(deployment.id, linkProject?.id || null)}
                className="flex w-full items-center justify-between gap-3 border border-border px-3 py-2.5 text-left hover:border-accent/50 hover:bg-card"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{deployment.name}</span>
                </span>
                <Plus size={14} className="shrink-0 text-muted" aria-hidden="true" />
              </button>
            ))}
        </div>
      </ModalSurface>

      <ModalSurface
        open={Boolean(moveDeployment)}
        onClose={() => setMoveDeployment(null)}
        title={moveDeployment ? `Move ${moveDeployment.name}` : "Move deployment"}
        description="Choose a project or leave the deployment ungrouped."
      >
        <div className="space-y-1">
          <button type="button" disabled={busy} onClick={() => moveDeployment && void assignDeployment(moveDeployment.id, null)} className="flex w-full items-center justify-between border border-border px-3 py-2.5 text-left text-sm hover:border-accent/50 hover:bg-card">
            <span>Ungrouped</span><span className="font-mono text-[10px] text-muted">No project</span>
          </button>
          {projects.map((project) => (
            <button key={project.id} type="button" disabled={busy} onClick={() => moveDeployment && void assignDeployment(moveDeployment.id, project.id)} className="flex w-full items-center justify-between border border-border px-3 py-2.5 text-left text-sm hover:border-accent/50 hover:bg-card">
              <span>{project.name}</span>
            </button>
          ))}
        </div>
      </ModalSurface>
    </div>
  );
}

function DeploymentRows({
  deployments,
  activeProjectId,
  onMove,
  onAssign,
}: {
  deployments: DeploymentSummary[];
  activeProjectId: number | null;
  onMove: (deployment: DeploymentSummary) => void;
  onAssign: (deploymentId: number, projectGroupId: number | null) => Promise<void>;
}) {
  if (deployments.length === 0) {
    return <div className="px-4 py-5 text-xs text-muted">No deployments in this project.</div>;
  }
  return (
    <div className="divide-y divide-border">
      {deployments.map((deployment) => {
        const liveUrl = deployment.publicUrl || (deployment.domain ? `https://${deployment.domain}` : null);
        return (
          <article key={deployment.id} className="grid gap-3 px-4 py-3 transition-colors hover:bg-background/35 md:grid-cols-[1fr_auto] md:items-center">
            <Link href={`/deployments/${deployment.slug}`} className="group min-w-0">
              <div className="truncate text-sm font-medium group-hover:text-accent">{deployment.name}</div>
              {liveUrl && <p className="mt-1 truncate text-[10px] text-muted">{deployment.domain || liveUrl}</p>}
            </Link>
            <div className="flex items-center justify-end gap-1.5">
              {liveUrl && (
                <a href={liveUrl} target="_blank" rel="noreferrer" className="gc-icon-button" aria-label={`Open ${deployment.name} live site`}>
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              )}
              {deployment.repoUrl && (
                <a href={deployment.repoUrl} target="_blank" rel="noreferrer" className="gc-icon-button" aria-label={`Open ${deployment.name} repository`}>
                  <FolderGit2 size={14} aria-hidden="true" />
                </a>
              )}
              <ContextActionMenu label={`Actions for ${deployment.name}`}>
                {(close) => (
                  <>
                    <ContextMenuAction href={`/deployments/${deployment.slug}`}>
                      Open deployment
                    </ContextMenuAction>
                    <ContextMenuAction onClick={() => {
                      close();
                      onMove(deployment);
                    }}>
                      <Link2 size={14} aria-hidden="true" />
                      Move to project
                    </ContextMenuAction>
                    {activeProjectId !== null && (
                      <ContextMenuAction onClick={() => {
                        close();
                        void onAssign(deployment.id, null);
                      }}>
                        <Unlink size={14} aria-hidden="true" />
                        Remove from project
                      </ContextMenuAction>
                    )}
                  </>
                )}
              </ContextActionMenu>
            </div>
          </article>
        );
      })}
    </div>
  );
}
