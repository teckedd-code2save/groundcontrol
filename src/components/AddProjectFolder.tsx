"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Folder, FolderGit2, RefreshCw } from "lucide-react";
import { ModalSurface } from "./ModalSurface";
import { Notice } from "./ui";
import type { SourceProject } from "@/lib/source-discovery";
import type { FolderListing } from "@/lib/project-folder-browser";

export function AddProjectFolder({ onClose, onAdded, localDesktop, hostId, projectId, projectName, onBack }: {
  onClose: () => void;
  onAdded: (name: string, project?: { id: number; name: string; slug: string }) => void | Promise<void>;
  onBack?: () => void;
  localDesktop?: boolean;
  hostId?: number | null;
  projectId?: number;
  projectName?: string;
}) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [projects, setProjects] = useState<SourceProject[] | null>(null);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [warning, setWarning] = useState("");
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState<"browse" | "scan" | "add" | null>(null);
  const [error, setError] = useState("");
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);

  const request = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/deployment-inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, hostId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not open this folder. Try again.");
    return data;
  }, [hostId]);

  const browse = useCallback(async (sourcePath?: string, hidden = false) => {
    setBusy("browse"); setError(""); setWarning(""); setProjects(null); setSelected(""); setFilter("");
    try { setListing(await request({ action: "browse_folders", sourcePath, showHidden: hidden })); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not open this folder."); }
    finally { setBusy(null); }
  }, [request]);
  useEffect(() => { void browse(); }, [browse]);

  async function scan() {
    if (!listing) return;
    setBusy("scan"); setError("");
    try {
      const data = await request({ action: "inspect_folder", sourcePath: listing.path });
      setWarning(data.warning || "");
      const found: SourceProject[] = data.projects.length ? data.projects : [data.folder];
      const chosen = found.find((item) => item.sourcePath === data.root) || (found.length === 1 ? found[0] : null);
      setProjects(found); setSelected(chosen?.sourcePath || ""); setName(chosen?.name || "");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not scan this folder."); }
    finally { setBusy(null); }
  }
  async function add() {
    setBusy("add"); setError("");
    try {
      const data = await request({ action: "add_source", sourcePath: selected, projectId, name, description });
      await onAdded(data.project?.name || data.deployment?.name || name, data.project);
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not add this project."); }
    finally { setBusy(null); }
  }
  const visibleFolders = listing?.folders.filter((folder) => folder.name.toLowerCase().includes(filter.toLowerCase())) || [];
  return <ModalSurface open onClose={close} size="lg" title={projectId ? `Add source to ${projectName || "project"}` : projects ? "Review project" : "Choose a folder"} description={localDesktop ? "Browse this computer and choose your project folder." : "Browse the selected server and choose your project folder."} footer={<>
    <button type="button" disabled={!!busy} onClick={onClose} className="gc-button gc-button-quiet">Cancel</button>
    {projects ? <button type="button" disabled={!selected || !name.trim() || !!busy} onClick={() => void add()} className="gc-button gc-button-primary"><FolderGit2 size={15} />{busy === "add" ? "Adding…" : projectId ? "Add source folder" : "Add project"}</button>
      : <button type="button" disabled={!listing?.canSelect || !!listing?.error || !!busy} onClick={() => void scan()} className="gc-button gc-button-primary"><FolderGit2 size={15} />{busy === "scan" ? "Checking folder…" : "Use this folder"}</button>}
  </>}>
    {onBack && <button type="button" disabled={!!busy} onClick={onBack} className="gc-button gc-button-quiet mb-4"><ArrowLeft size={14} />Change source</button>}
    {(warning || listing?.warning) && <div className="mb-4"><Notice>{warning || listing?.warning}</Notice></div>}
    {error && <div role="alert" className="mb-4"><Notice tone="danger">{error}</Notice><button type="button" disabled={!!busy} onClick={() => void browse(listing?.path, showHidden)} className="gc-button gc-button-quiet mt-2">Try again</button></div>}
    {!projects ? <div className="space-y-4" aria-busy={busy === "browse"}>
      {listing && <>
        <div className="flex flex-wrap gap-2" aria-label="Locations">{listing.roots.map((root) => <button type="button" key={root.path} disabled={!!busy} onClick={() => void browse(root.path, showHidden)} className={`gc-button ${listing.path === root.path ? "gc-button-secondary" : "gc-button-quiet"}`}><Folder size={14} />{root.name}</button>)}</div>
        <nav aria-label="Folder location" className="flex flex-wrap items-center gap-1 border-y border-border py-2">{listing.breadcrumbs.map((crumb, index) => <span key={crumb.path} className="inline-flex min-w-0 items-center gap-1">{index > 0 && <ChevronRight size={12} className="shrink-0 text-muted" />}<button type="button" disabled={!!busy} aria-current={crumb.path === listing.path ? "location" : undefined} onClick={() => void browse(crumb.path, showHidden)} className="break-all px-1 py-1 text-xs hover:text-accent">{crumb.name}</button></span>)}</nav>
        <div className="flex items-center gap-2"><button type="button" aria-label="Up one folder" disabled={!listing.parentPath || !!busy} className="gc-icon-button" onClick={() => listing.parentPath && void browse(listing.parentPath, showHidden)}><ArrowLeft size={16} /></button><input type="search" aria-label="Filter folders" placeholder="Filter folders" value={filter} onChange={(event) => setFilter(event.target.value)} className="gc-field min-w-0 flex-1" /><button type="button" aria-label="Refresh folders" disabled={!!busy} className="gc-icon-button" onClick={() => void browse(listing.path, showHidden)}><RefreshCw size={15} /></button></div>
      </>}
      {busy === "browse" ? <p role="status" className="p-6 text-center text-sm text-muted">Opening folders…</p> : listing?.error ? <div role="alert"><Notice tone="danger">{listing.error}</Notice></div> : <div className="max-h-64 overflow-auto border border-border" aria-label="Folders">
        {visibleFolders.map((folder) => <button type="button" key={folder.path} disabled={!!busy} aria-label={`Open folder ${folder.name}`} onClick={() => void browse(folder.path, showHidden)} className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left last:border-b-0 hover:bg-card focus-visible:bg-card"><Folder size={17} className="shrink-0 text-accent" /><span className="min-w-0 flex-1 break-words text-sm">{folder.name}</span><ChevronRight size={14} className="shrink-0 text-muted" /></button>)}
        {listing && visibleFolders.length === 0 && <p className="p-6 text-sm text-muted">{filter ? "No folders match your search." : "No folders inside. You can select this folder."}</p>}
      </div>}
      {listing && <><label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" disabled={!!busy} checked={showHidden} onChange={(event) => { setShowHidden(event.target.checked); void browse(listing.path, event.target.checked); }} />Show hidden folders</label><p className="break-all text-xs text-muted"><span className="font-medium text-foreground">Selected folder:</span> {listing.path}</p></>}
    </div> : <div className="space-y-4">
      <button type="button" disabled={!!busy} onClick={() => { setProjects(null); setError(""); }} className="gc-button gc-button-quiet"><ArrowLeft size={14} />Choose a different folder</button>
      <h3 className="text-sm font-medium">{projects.length === 1 ? "Project found" : `${projects.length} projects found — choose one to add`}</h3>
      <fieldset className="max-h-56 space-y-2 overflow-auto" disabled={!!busy}><legend className="sr-only">Choose a project</legend>{projects.map((project) => <label key={project.sourcePath} className={`flex cursor-pointer items-start gap-3 border p-3 ${selected === project.sourcePath ? "border-accent bg-accent/5" : "border-border bg-card"}`}><input type="radio" name="source-project" value={project.sourcePath} checked={selected === project.sourcePath} onChange={() => { setSelected(project.sourcePath); setName(project.name); }} className="mt-1" /><span className="min-w-0"><span className="block text-sm font-medium">{project.name}</span><span className="mt-1 block break-all font-mono text-[10px] text-muted">{project.sourcePath}</span><span className="mt-2 block text-xs text-muted">{project.technologies.join(" · ") || "Project folder"}</span></span></label>)}</fieldset>
      {!projectId && <label className="block"><span className="gc-label">Project name</span><input disabled={!!busy} value={name} onChange={(event) => setName(event.target.value)} className="gc-field mt-2 w-full" placeholder="Customer portal" /></label>}
      {!projectId && <label className="block"><span className="gc-label">Purpose · optional</span><textarea className="gc-field mt-2 w-full" rows={2} maxLength={2000} value={description} disabled={!!busy} onChange={(event) => setDescription(event.target.value)} placeholder="What this project is for" /></label>}
      <p className="text-xs leading-relaxed text-muted">This connects your source folder to a project. You can add local, staging, or production deployments separately.</p>
    </div>}
  </ModalSurface>;
}
