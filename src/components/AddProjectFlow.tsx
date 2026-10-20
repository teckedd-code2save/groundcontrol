"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ExternalLink, Folder, GitBranch, LockKeyhole, RefreshCw } from "lucide-react";
import { ModalSurface } from "./ModalSurface";
import { Notice } from "./ui";
import { AddProjectFolder } from "./AddProjectFolder";
import type { GithubProjectSource } from "@/lib/github-project-import";

type AddedProject = { id: number; name: string; slug: string };
type AddProps = {
  localDesktop?: boolean; hostId?: number | null; hostName?: string;
  onClose: () => void; onAdded: (name: string, project?: AddedProject) => void | Promise<void>;
  onEmpty?: () => void;
};
export function AddProjectFlow(props: AddProps) {
  const [source, setSource] = useState<"choose" | "folder" | "github">("choose");
  const back = useCallback(() => setSource("choose"), []);
  if (source === "folder") return <AddProjectFolder {...props} onBack={back} />;
  if (source === "github") return <GithubProjectPicker onClose={props.onClose} onBack={back} onAdded={props.onAdded} />;
  return <ModalSurface open onClose={props.onClose} title="Add project" description="Start with the code you already have." size="lg" footer={<button type="button" onClick={props.onClose} className="gc-button gc-button-quiet">Cancel</button>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <button type="button" onClick={() => setSource("folder")} className="group flex min-h-44 flex-col items-start border border-border bg-card p-5 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent">
        <Folder size={24} className="mb-5 text-accent" aria-hidden="true" /><span className="flex w-full items-center justify-between gap-3 text-base font-medium">Choose a folder<ArrowRight size={16} aria-hidden="true" /></span>
        <span className="mt-2 text-xs leading-relaxed text-muted">{props.localDesktop ? "Browse this computer and pick your project folder." : `Browse ${props.hostName || "the selected server"} and pick your project folder.`}</span>
      </button>
      <button type="button" onClick={() => setSource("github")} className="group flex min-h-44 flex-col items-start border border-border bg-card p-5 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent">
        <GitBranch size={24} className="mb-5 text-accent" aria-hidden="true" /><span className="flex w-full items-center justify-between gap-3 text-base font-medium">Import from GitHub<ArrowRight size={16} aria-hidden="true" /></span>
        <span className="mt-2 text-xs leading-relaxed text-muted">Choose a repository from your connected account, or browse public repositories.</span>
      </button>
    </div>
    <p className="mt-5 text-xs leading-relaxed text-muted">Review the name and source, then add your project. Deployments come next.</p>
    {props.onEmpty && <button type="button" onClick={props.onEmpty} className="gc-button gc-button-quiet mt-3">Start without source code</button>}
  </ModalSurface>;
}

type RepositoryOption = { id: string | number; name: string; fullName: string; url: string; defaultBranch?: string; private?: boolean; description?: string };
async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load repositories. Try again.");
  return data;
}
function GithubProjectPicker({ onClose, onBack, onAdded }: Pick<AddProps, "onClose" | "onAdded"> & { onBack: () => void }) {
  const [repositories, setRepositories] = useState<RepositoryOption[]>([]);
  const [access, setAccess] = useState("");
  const [hasConnected, setHasConnected] = useState(false);
  const [publicMode, setPublicMode] = useState(false);
  const [owner, setOwner] = useState("");
  const [loadedOwner, setLoadedOwner] = useState("");
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(40);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [repoLink, setRepoLink] = useState("");
  const [selected, setSelected] = useState<GithubProjectSource | null>(null);
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<"load" | "inspect" | "add" | null>("load");
  const [error, setError] = useState("");
  const close = useCallback(() => { if (busy !== "add") onClose(); }, [busy, onClose]);
  const load = useCallback(async (requestedOwner = "", requestedPage = 1, publicOnly = false, signal?: AbortSignal) => {
    setBusy("load"); setError("");
    try {
      const params = new URLSearchParams({ owner: requestedOwner.trim(), page: String(requestedPage), ...(publicOnly ? { access: "public" } : {}) });
      const data = await readResponse(await fetch(`/api/github/repositories?${params}`, { cache: "no-store", signal }));
      if (signal?.aborted) return;
      setAccess(data.access); setPublicMode(publicOnly); if (!publicOnly) setHasConnected(data.access === "github_app"); setLoadedOwner(requestedOwner.trim()); setPage(requestedPage); setHasMore(Boolean(data.hasMore));
      setRepositories((existing) => requestedPage === 1 ? data.repositories || [] : [...existing, ...(data.repositories || []).filter((item: RepositoryOption) => !existing.some((known) => known.fullName === item.fullName))]);
      if (requestedPage === 1) { setFilter(""); setLimit(40); } else setLimit((value) => value + 100);
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "Could not load repositories."); }
    finally { if (!signal?.aborted) setBusy(null); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load("", 1, false, controller.signal); return () => controller.abort(); }, [load]);
  const matching = useMemo(() => repositories.filter((repo) => repo.fullName.toLowerCase().includes(filter.toLowerCase())), [repositories, filter]);
  async function inspect(url: string) {
    setBusy("inspect"); setError("");
    try {
      const data = await readResponse(await fetch(`/api/project-import/github?url=${encodeURIComponent(url)}`));
      setSelected(data.repository); setName(data.repository.name); setDescription(data.repository.description || "");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open this repository."); }
    finally { setBusy(null); }
  }
  async function add() {
    if (!selected) return; setBusy("add"); setError("");
    try {
      const data = await readResponse(await fetch("/api/project-import/github", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryUrl: selected.url, name, description }) }));
      await onAdded(data.project.name, data.project); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not add project."); }
    finally { setBusy(null); }
  }
  return <ModalSurface open onClose={close} size="lg" title={selected ? "Review project" : "Import from GitHub"} description={selected ? "Your repository is selected. Give this project a name and purpose." : "Choose the repository that belongs to your project."} footer={<>
    <button type="button" disabled={busy === "add"} onClick={onClose} className="gc-button gc-button-quiet">Cancel</button>
    {selected && <button type="button" disabled={!!busy || !name.trim()} onClick={() => void add()} className="gc-button gc-button-primary"><Check size={15} />{busy === "add" ? "Adding…" : "Add project"}</button>}
  </>}>
    <div className="space-y-4">
      <button type="button" disabled={!!busy} className="gc-button gc-button-quiet" onClick={() => { setError(""); if (selected) setSelected(null); else onBack(); }}><ArrowLeft size={14} />{selected ? "Choose a different repository" : "Change source"}</button>
      {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
      {selected ? <>
        <div className="border border-border bg-card p-4"><p className="flex items-center gap-2 text-sm font-medium"><GitBranch size={17} />{selected.fullName}</p><p className="mt-2 flex items-center gap-2 text-xs text-muted"><GitBranch size={13} />{selected.defaultBranch} · {selected.private ? "Private repository" : "Public repository"}</p></div>
        <label className="block"><span className="gc-label">Project name</span><input data-autofocus className="gc-field mt-2 w-full" maxLength={120} value={name} disabled={!!busy} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block"><span className="gc-label">Purpose · optional</span><textarea className="gc-field mt-2 w-full" rows={3} maxLength={2000} value={description} disabled={!!busy} onChange={(e) => setDescription(e.target.value)} /></label>
        <p className="text-xs leading-relaxed text-muted">GroundControl will save this repository as your project’s source. You can choose where and how to deploy it from the project page.</p>
      </> : <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-muted">{access === "github_app" && !publicMode ? "Repositories from your connected GitHub accounts" : "Public GitHub repositories"}</span><a href="/settings?tab=connectors" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{access === "github_app" ? "Manage GitHub access" : "Connect GitHub for private repos"}<ExternalLink size={12} /></a></div>
        {(access !== "github_app" || publicMode) && <form onSubmit={(e) => { e.preventDefault(); void load(owner, 1, true); }} className="flex items-end gap-2"><label className="min-w-0 flex-1"><span className="gc-label">GitHub user or organization</span><input className="gc-field mt-2 w-full" placeholder="your-team" value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!!busy} /></label><button type="submit" className="gc-button gc-button-secondary" disabled={!!busy || !owner.trim()}>Find repositories</button></form>}
        <div className="flex items-center gap-2"><input type="search" className="gc-field min-w-0 flex-1" aria-label="Search repositories" placeholder="Search repositories" value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(40); }} /><button type="button" aria-label="Refresh repositories" className="gc-icon-button" disabled={!!busy} onClick={() => void load(publicMode ? loadedOwner : "", 1, publicMode)}><RefreshCw size={15} /></button></div>
        {busy && <p role="status" className="text-xs text-muted">{busy === "inspect" ? "Checking repository access…" : "Loading repositories…"}</p>}
        <div className="max-h-64 divide-y divide-border overflow-auto border border-border">
          {matching.slice(0, limit).map((repo) => <button type="button" key={repo.fullName} disabled={!!busy} onClick={() => void inspect(`https://github.com/${repo.fullName}`)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-card disabled:opacity-50"><GitBranch size={17} className="mt-0.5 shrink-0 text-muted" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-medium"><span className="break-all">{repo.fullName}</span>{repo.private && <LockKeyhole size={12} aria-label="Private" className="shrink-0 text-muted" />}</span>{repo.description && <span className="mt-1 block line-clamp-2 text-xs text-muted">{repo.description}</span>}<span className="mt-1 block text-xs text-muted">{repo.defaultBranch || "Default branch"}{repo.private ? " · Private" : " · Public"}</span></span><ArrowRight size={14} className="mt-1 shrink-0 text-muted" /></button>)}
          {!matching.length && !busy && <p className="p-5 text-sm leading-relaxed text-muted">{filter ? "No repositories match this search." : loadedOwner ? "No active public repositories found for this account." : access === "github_app" ? "No repositories are available. Review GitHub access, then refresh this list." : "Enter a GitHub user or organization to browse their public repositories. Connect GitHub to include your private repositories."}</p>}
        </div>
        {(matching.length > limit || hasMore) && <button type="button" disabled={!!busy} className="gc-button gc-button-quiet" onClick={() => matching.length > limit ? setLimit(limit + 40) : void load(loadedOwner, page + 1, true)}>Load more repositories</button>}
        <div className="flex flex-wrap gap-2">
          {access === "github_app" && !publicMode && <button type="button" disabled={!!busy} className="gc-button gc-button-quiet" onClick={() => { setPublicMode(true); setRepositories([]); setFilter(""); }}>Browse a public account</button>}
          {publicMode && hasConnected && <button type="button" disabled={!!busy} className="gc-button gc-button-quiet" onClick={() => { setPublicMode(false); void load(); }}>Connected accounts</button>}
          <button type="button" disabled={!!busy} className="gc-button gc-button-quiet" onClick={() => setLinkOpen(!linkOpen)}>Use a repository link</button>
        </div>
        {linkOpen && <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void inspect(repoLink); }}><label className="min-w-0 flex-1"><span className="gc-label">GitHub repository link</span><input type="url" className="gc-field mt-2 w-full" placeholder="https://github.com/owner/repository" value={repoLink} onChange={(e) => setRepoLink(e.target.value)} disabled={!!busy} required /></label><button className="gc-button gc-button-secondary" disabled={!!busy || !repoLink.trim()}>Review</button></form>}
      </>}
    </div>
  </ModalSurface>;
}
