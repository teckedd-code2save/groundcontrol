"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, FolderGit2, Plus, Settings2, Unlink } from "lucide-react";
import { ModalSurface } from "./ModalSurface";
import { AddProjectFlow } from "./AddProjectFlow";
import { AddProjectFolder } from "./AddProjectFolder";
import { AddProjectDeployment, type ProjectDeployment } from "./AddProjectDeployment";
import { Notice } from "./ui";

type ProjectSource = { id: number; path: string; hostName: string; technologies: string[] };
type Project = { id: number; slug: string; name: string; description: string; repositoryUrl?: string | null; sources: ProjectSource[]; deployments: ProjectDeployment[] };
async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, options); const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save this change."); return data;
}
export function ProjectGroupsPanel({ projectSlug }: { projectSlug?: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ungrouped, setUngrouped] = useState<ProjectDeployment[]>([]);
  const [connection, setConnection] = useState<{ localDesktop?: boolean; hostId?: number | null; hostName?: string }>({});
  const [loading, setLoading] = useState(true);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [folder, setFolder] = useState<Project | "new" | null>(null);
  const [addDeployment, setAddDeployment] = useState<Project | null>(null);
  const [edit, setEdit] = useState<Project | "new" | null>(null);
  const [move, setMove] = useState<ProjectDeployment | null>(null);
  const [moveProjectId, setMoveProjectId] = useState("");
  const [environment, setEnvironment] = useState("");
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [repositoryUrl, setRepositoryUrl] = useState("");
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const data = await request("/api/project-groups", { cache: "no-store" });
    setProjects(data.projects || []); setUngrouped(data.ungrouped || []); setConnection({ localDesktop: data.localDesktop, hostId: data.hostId, hostName: data.hostName });
  }, []);
  useEffect(() => { void load().catch((error) => setError(error.message)).finally(() => setLoading(false)); }, [load]);
  const active = projects.find((project) => project.slug === projectSlug);
  function openEdit(project: Project | "new") {
    setEdit(project); setName(project === "new" ? "" : project.name); setDescription(project === "new" ? "" : project.description); setRepositoryUrl(project === "new" ? "" : project.repositoryUrl || ""); setError("");
  }
  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError("");
    try { await action(); await load(); setMessage(success); return true; }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
    finally { setBusy(false); }
  }
  async function saveProject() {
    const ok = await mutate(() => request(edit === "new" ? "/api/project-groups" : `/api/project-groups/${(edit as Project).id}`, { method: edit === "new" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, repositoryUrl }) }), edit === "new" ? "Project created. Add its source and deployments when you’re ready." : "Project updated.");
    if (ok) setEdit(null);
  }
  function editDeployment(deployment: ProjectDeployment, projectId?: number) { setMove(deployment); setMoveProjectId(projectId ? String(projectId) : ""); setEnvironment(deployment.environmentName); }
  const closeAddProject = useCallback(() => setAddProjectOpen(false), []);
  const closeFolder = useCallback(() => setFolder(null), []);
  const closeDeployment = useCallback(() => setAddDeployment(null), []);
  const closeEdit = useCallback(() => { if (!busy) setEdit(null); }, [busy]);
  const closeMove = useCallback(() => { if (!busy) setMove(null); }, [busy]);
  const renderDeployments = (items: ProjectDeployment[], projectId?: number) => <div className="divide-y divide-border">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-4">
    <Link href={`/deployments/${item.slug}`} className="min-w-0 flex-1"><span className="block text-sm font-medium hover:text-accent">{item.name}</span><span className="mt-1 block text-xs text-muted">{item.environmentName} · {item.hostName} · {item.method === "compose" ? "Docker Compose" : item.method}</span>{item.publicUrl && <span className="mt-1 block truncate text-xs text-muted">{item.publicUrl}</span>}</Link>
    <button className="gc-icon-button" aria-label={`Settings for ${item.name}`} onClick={() => editDeployment(item, projectId)}><Settings2 size={15} /></button><Link href={`/deployments/${item.slug}`} className="gc-icon-button" aria-label={`Open ${item.name}`}><ArrowUpRight size={17} /></Link>
  </div>)}</div>;
  if (loading) return <p className="p-6 text-sm text-muted">Loading projects…</p>;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6"><div>
      {projectSlug ? <Link href="/projects" className="gc-button gc-button-quiet mb-3"><ArrowLeft size={14} />All projects</Link> : <p className="gc-eyebrow">Your workspace</p>}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{projectSlug ? active?.name || "Project not found" : "Projects"}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{active ? active.description || "Your project’s source and running environments, together." : "A home for each app or product. Keep its source, purpose, and deployments together."}</p>
    </div><div className="flex flex-wrap gap-2">{active ? <><button className="gc-button gc-button-secondary" onClick={() => openEdit(active)}><Settings2 size={14} />Project settings</button><button className="gc-button gc-button-primary" onClick={() => setAddDeployment(active)}><Plus size={14} />Add deployment</button></> : !projectSlug && <button className="gc-button gc-button-primary" onClick={() => setAddProjectOpen(true)}><Plus size={14} />Add project</button>}</div></header>
    {message && <Notice tone="success">{message}</Notice>}{error && !edit && !move && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
    {!projectSlug && <>
      {!projects.length && <div className="border border-dashed border-border p-8"><h2 className="text-lg font-medium">Start with the project you’re building</h2><p className="mt-2 max-w-xl text-sm text-muted">Choose a folder or a GitHub repository to start your project. Add Local, Staging, and Production deployments as you need them.</p></div>}
      <div className="grid gap-4 lg:grid-cols-2">{projects.map((project) => <section key={project.id} id={project.slug} className="flex flex-col border border-border bg-card p-5"><Link href={`/projects/${project.slug}`} className="group flex-1"><div className="flex items-start justify-between gap-4"><h2 className="text-lg font-medium group-hover:text-accent">{project.name}</h2><ArrowUpRight size={18} className="text-muted" /></div><p className="mt-2 min-h-10 text-sm leading-relaxed text-muted">{project.description || "Add a purpose in project settings."}</p><p className="mt-4 text-xs text-muted">{project.sources?.length || 0} source folder(s){project.repositoryUrl ? " · Repository connected" : ""}</p></Link><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><span className="text-xs text-muted">{project.deployments.length ? `${project.deployments.length} deployment(s) · ${[...new Set(project.deployments.map((d) => d.environmentName))].join(", ")}` : "No deployments yet"}</span><button onClick={() => setAddDeployment(project)} className="gc-button gc-button-secondary"><Plus size={14} />Add deployment</button></div></section>)}</div>
      {ungrouped.length > 0 && <section className="border border-dashed border-border p-5"><h2 className="text-base font-medium">Deployments without a project</h2><p className="mt-1 text-xs text-muted">Use deployment settings to assign these to a project.</p>{renderDeployments(ungrouped)}</section>}
    </>}
    {active && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <section className="min-w-0 border border-border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-medium">Source</h2><button className="gc-button gc-button-quiet" onClick={() => setFolder(active)}><Plus size={14} />Choose folder</button></div><p className="mt-2 text-xs leading-relaxed text-muted">The code for this project. A source folder can be used by several deployments.</p>
        {active.repositoryUrl && <a className="mt-5 flex items-center gap-2 break-all text-sm text-accent" href={active.repositoryUrl} target="_blank" rel="noreferrer"><FolderGit2 size={16} className="shrink-0" />{active.repositoryUrl}<ArrowUpRight size={14} className="shrink-0" /></a>}
        {(active.sources || []).map((source) => <div key={source.id} className="mt-4 border-t border-border pt-4"><div className="flex items-start justify-between gap-2"><p className="break-all text-sm">{source.path.split("/").pop()}</p><button disabled={busy} className="gc-icon-button shrink-0" aria-label={`Remove source ${source.path}`} onClick={() => void mutate(() => request(`/api/project-sources/${source.id}`, { method: "DELETE" }), "Source link removed. Your files are unchanged.")}><Unlink size={14} /></button></div><p className="mt-1 break-all text-xs text-muted">{source.path}</p><p className="mt-2 text-xs text-muted">{source.hostName} · {source.technologies.join(" · ") || "Source folder"}</p></div>)}
        {!active.sources?.length && !active.repositoryUrl && <div className="mt-5 border border-dashed border-border p-4 text-sm text-muted">Choose a folder or add a repository in project settings.</div>}
      </section>
      <section className="min-w-0 border border-border bg-card p-5"><h2 className="text-base font-medium">Deployments</h2><p className="mt-2 text-xs leading-relaxed text-muted">Instances of {active.name}, each with its own environment, host, configuration, and release history.</p>{active.deployments.length ? renderDeployments(active.deployments, active.id) : <div className="mt-5 border border-dashed border-border p-6"><h3 className="text-sm font-medium">Your project is ready for its first deployment</h3><p className="mt-2 text-xs leading-relaxed text-muted">Connect an app that’s already running, or launch a new instance.</p><button className="gc-button gc-button-primary mt-4" onClick={() => setAddDeployment(active)}><Plus size={14} />Add deployment</button></div>}</section>
    </div>}
    {addProjectOpen && <AddProjectFlow {...connection} onClose={closeAddProject} onEmpty={() => { setAddProjectOpen(false); openEdit("new"); }} onAdded={async (name) => { await load(); setMessage(`${name} added. Open the project to add a deployment.`); }} />}
    {folder && <AddProjectFolder {...connection} projectId={folder === "new" ? undefined : folder.id} projectName={folder === "new" ? undefined : folder.name} onClose={closeFolder} onAdded={async (name) => { await load(); setMessage(`${name} source saved. No deployment has been started.`); }} />}
    {addDeployment && <AddProjectDeployment project={addDeployment} connection={connection} deployments={[...ungrouped, ...projects.filter((p) => p.id !== addDeployment.id).flatMap((p) => p.deployments.map((d) => ({ ...d, projectName: p.name })))]} onClose={closeDeployment} onAdded={async () => { await load(); setMessage("Deployment connected to project."); }} />}
    <ModalSurface open={!!edit} onClose={closeEdit} title={edit === "new" ? "New project" : "Project settings"} description="Name the app or product, then add its purpose and source repository.">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveProject(); }}>
        {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
        <label className="block"><span className="gc-label">Project name</span><input className="gc-field mt-2 w-full" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Customer Portal" required /></label>
        <label className="block"><span className="gc-label">Purpose · optional</span><textarea className="gc-field mt-2 w-full" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this project is for" /></label>
        <label className="block"><span className="gc-label">Repository link · optional</span><input type="url" className="gc-field mt-2 w-full" value={repositoryUrl} onChange={(e) => setRepositoryUrl(e.target.value)} placeholder="https://github.com/your-team/customer-portal" /></label>
        <div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" disabled={busy} className="gc-button gc-button-quiet" onClick={closeEdit}>Cancel</button><button disabled={busy || !name.trim()} className="gc-button gc-button-primary">{busy ? "Saving…" : edit === "new" ? "Create project" : "Save project"}</button></div>
      </form>
    </ModalSurface>
    <ModalSurface open={!!move} onClose={closeMove} title={`Settings for ${move?.name || "deployment"}`} description="Organize this deployment without moving its running services.">
      {error && <Notice tone="danger">{error}</Notice>}<div className="space-y-4"><label className="block"><span className="gc-label">Project</span><select className="gc-field mt-2 w-full" value={moveProjectId} onChange={(e) => setMoveProjectId(e.target.value)}><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="block"><span className="gc-label">Environment</span><input className="gc-field mt-2 w-full" value={environment} maxLength={60} onChange={(e) => setEnvironment(e.target.value)} /></label><button disabled={busy || !environment.trim()} className="gc-button gc-button-primary" onClick={async () => { if (await mutate(() => request(`/api/projects/${move!.id}/group`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectGroupId: moveProjectId ? Number(moveProjectId) : null, environmentName: environment }) }), "Deployment updated.")) setMove(null); }}>Save deployment</button></div>
    </ModalSurface>
  </div>;
}
