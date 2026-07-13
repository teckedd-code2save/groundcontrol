"use client";

import { useCallback, useEffect, useState } from "react";

type DeploymentSummary = {
  id: number;
  slug: string;
  name: string;
  path: string;
  domain: string | null;
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [openMenu, setOpenMenu] = useState<number | null>(null);

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

  async function createProject() {
    if (!name.trim()) return;
    const response = await fetch("/api/project-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const data = await readJson(response);
    if (!response.ok || data.error) {
      setMessage(data.error || "Could not create project");
      return;
    }
    setName("");
    setDescription("");
    setCreateOpen(false);
    setMessage("Project created");
    await load();
  }

  async function assignDeployment(deploymentId: number, projectGroupId: number | null) {
    const response = await fetch(`/api/projects/${deploymentId}/group`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectGroupId }),
    });
    const data = await readJson(response);
    if (!response.ok || data.error) {
      setMessage(data.error || "Could not move deployment");
      return;
    }
    setMessage(projectGroupId ? "Deployment assigned to project" : "Deployment moved to ungrouped");
    await load();
  }

  async function deleteProject(projectId: number) {
    const response = await fetch(`/api/project-groups/${projectId}`, { method: "DELETE" });
    const data = await readJson(response);
    if (!response.ok || data.error) {
      setMessage(data.error || "Could not delete project");
      return;
    }
    setOpenMenu(null);
    setMessage("Project removed; its deployments are now ungrouped");
    await load();
  }

  if (loading) return <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted">Loading projects…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">Organization</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Projects</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Projects only group deployments. Runtime configuration remains on each deployment.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen((open) => !open)}
          className="rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90"
        >
          {createOpen ? "Cancel" : "New project"}
        </button>
      </div>

      {message && <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted">{message}</div>}

      {createOpen && (
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-[1fr_1.5fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-wide text-muted">Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="GroundControl" className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-accent/40 focus:ring-1" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-wide text-muted">Description</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional context" className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-accent/40 focus:ring-1" />
          </label>
          <button type="button" onClick={createProject} disabled={!name.trim()} className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">Create</button>
        </div>
      )}

      <div className="space-y-3">
        {projects.map((project) => (
          <section key={project.id} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-start justify-between gap-3 px-4 py-4">
              <div>
                <h2 className="text-base font-medium tracking-tight">{project.name}</h2>
                <p className="mt-1 text-xs text-muted">{project.description || `${project.deployments.length} deployment${project.deployments.length === 1 ? "" : "s"}`}</p>
              </div>
              <div className="relative">
                <button type="button" onClick={() => setOpenMenu(openMenu === project.id ? null : project.id)} aria-label={`Actions for ${project.name}`} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted hover:text-foreground">⋯</button>
                {openMenu === project.id && (
                  <div className="absolute right-0 top-10 z-20 w-48 overflow-hidden rounded-md border border-border bg-background shadow-xl">
                    <button type="button" onClick={() => deleteProject(project.id)} className="w-full px-3 py-2 text-left text-xs text-error hover:bg-error/10">Delete project</button>
                  </div>
                )}
              </div>
            </div>
            <DeploymentRows deployments={project.deployments} projects={projects} activeProjectId={project.id} onAssign={assignDeployment} />
          </section>
        ))}

        <section className="overflow-hidden rounded-lg border border-dashed border-border bg-card/60">
          <div className="px-4 py-4">
            <h2 className="text-sm font-medium">Ungrouped deployments</h2>
            <p className="mt-1 text-xs text-muted">Enrolled deployments that have not been assigned to a project.</p>
          </div>
          <DeploymentRows deployments={ungrouped} projects={projects} activeProjectId={null} onAssign={assignDeployment} />
        </section>
      </div>
    </div>
  );
}

function DeploymentRows({ deployments, projects, activeProjectId, onAssign }: {
  deployments: DeploymentSummary[];
  projects: ProjectGroup[];
  activeProjectId: number | null;
  onAssign: (deploymentId: number, projectGroupId: number | null) => void;
}) {
  if (deployments.length === 0) return <div className="border-t border-border px-4 py-5 text-xs text-muted">No deployments in this project.</div>;
  return (
    <div className="divide-y divide-border border-t border-border">
      {deployments.map((deployment) => (
        <div key={deployment.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{deployment.name}</span>
              <span className="rounded bg-background px-1.5 py-0.5 text-[9px] font-mono uppercase text-muted">{deployment.status || "unknown"}</span>
            </div>
            <p className="mt-1 truncate text-[10px] font-mono text-muted">{deployment.domain || deployment.path || deployment.slug}</p>
          </div>
          <label className="flex items-center gap-2 text-[10px] font-mono text-muted">
            Project
            <select value={activeProjectId ?? ""} onChange={(event) => onAssign(deployment.id, event.target.value ? Number(event.target.value) : null)} className="rounded-md bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-accent">
              <option value="">Ungrouped</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </div>
      ))}
    </div>
  );
}
