"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FolderGit2,
  Layers3,
  Link2,
  Plus,
  ScanLine,
  ServerCog,
  Unlink,
} from "lucide-react";
import {
  ContextActionMenu,
  ContextMenuAction,
  ContextMenuDivider,
  ContextMenuLabel,
} from "@/components/ContextActionMenu";
import { ModalSurface } from "@/components/ModalSurface";
import { AddProjectFlow } from "./AddProjectFlow";
import { Notice } from "@/components/ui";

type Group = { id: number; name: string; slug: string; description: string };
type Candidate = {
  id: string;
  kind: string;
  name: string;
  sourcePath?: string | null;
  composePath?: string | null;
  containerName?: string | null;
  state?: string;
  image?: string;
  components?: number;
  services?: { name: string; containerName: string; state: string; image: string }[];
  evidence: string[];
};
type Enrolled = {
  id: number;
  name: string;
  slug: string;
  kind: string;
  managementMode: string;
  environmentName?: string;
  sourcePath?: string | null;
  containerName?: string | null;
  projectId?: number | null;
  project?: Group | null;
  legacyProjectId?: number | null;
  legacyProjectSlug?: string | null;
  observedStatus: string;
  publicUrl?: string | null;
  repoUrl?: string | null;
  domain?: string | null;
  runtime?: {
    status: string;
    confidence: string;
    composeProject?: string | null;
    containers: Array<{ name: string; service?: string | null; state: string }>;
    evidence: string[];
  };
};

type LinkTarget =
  | { type: "deployment"; item: Enrolled }
  | { type: "candidate"; item: Candidate };

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Invalid response" };
  }
}

export function DeploymentWorkspace() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [deployments, setDeployments] = useState<Enrolled[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [localDesktop, setLocalDesktop] = useState(false);
  const [hostId, setHostId] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<Candidate | null>(null);
  const [newProjectName, setNewProjectName] = useState("");

  const load = useCallback(async (announce = false) => {
    setLoading(true);
    if (announce) setMessage({ tone: "info", text: "Scanning the active host for folders and containers…" });
    try {
      const data = await fetch("/api/deployment-inventory", { cache: "no-store" }).then(readJson);
      if (data.error) throw new Error(data.error);
      setGroups(data.projects || []);
      setDeployments(data.deployments || []);
      setCandidates(data.candidates || []);
      setHiddenCount(data.hiddenCount || 0);
      setLocalDesktop(Boolean(data.localDesktop));
      setHostId(data.hostId ?? null);
      if (data.discoveryError) setMessage({ tone: "error", text: data.discoveryError });
      else if (announce) setMessage({ tone: "success", text: "Host scan complete. Nothing was enrolled automatically." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function postInventory(body: Record<string, unknown>) {
    const response = await fetch("/api/deployment-inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, hostId }),
    });
    const data = await readJson(response);
    if (!response.ok || data.error) throw new Error(data.error || "Action failed");
    return data;
  }

  async function mutate(
    body: Record<string, unknown>,
    pending: string,
    success: string,
    busyKey: string
  ) {
    setBusy(busyKey);
    setMessage({ tone: "info", text: pending });
    try {
      await postInventory(body);
      await load();
      setMessage({ tone: "success", text: success });
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function linkTargetToProject(projectId: number | null) {
    if (!linkTarget) return;
    const targetName = linkTarget.item.name;
    const projectName = groups.find((group) => group.id === projectId)?.name || "Ungrouped";
    const body = linkTarget.type === "deployment"
      ? { action: "assign_project", deploymentId: linkTarget.item.id, projectId }
      : { action: "enroll", ...linkTarget.item, projectId };
    const success = linkTarget.type === "deployment"
      ? `${targetName} moved to ${projectName}.`
      : `${targetName} enrolled in ${projectName}.`;
    const ok = await mutate(
      body,
      linkTarget.type === "deployment" ? `Moving ${targetName}…` : `Enrolling ${targetName}…`,
      success,
      `link-${linkTarget.item.id}`
    );
    if (ok) {
      setLinkTarget(null);
      setNewProjectName("");
    }
  }

  async function createProjectAndLink() {
    if (!linkTarget || !newProjectName.trim()) return;
    const name = newProjectName.trim();
    setBusy("create-and-link");
    setMessage({ tone: "info", text: `Creating “${name}” and linking ${linkTarget.item.name}…` });
    try {
      const created = await postInventory({ action: "create_project", name });
      const projectId = Number(created.project?.id);
      if (!Number.isFinite(projectId)) throw new Error("Project was created without an id");
      if (linkTarget.type === "deployment") {
        await postInventory({
          action: "assign_project",
          deploymentId: linkTarget.item.id,
          projectId,
        });
      } else {
        await postInventory({ action: "enroll", ...linkTarget.item, projectId });
      }
      await load();
      setMessage({
        tone: "success",
        text: `Created “${name}” and linked ${linkTarget.item.name}.`,
      });
      setLinkTarget(null);
      setNewProjectName("");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, { group: Group | null; items: Enrolled[] }>();
    for (const deployment of deployments) {
      const key = deployment.project ? String(deployment.project.id) : "ungrouped";
      const current = map.get(key) || { group: deployment.project || null, items: [] };
      current.items.push(deployment);
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.group?.name || "Ungrouped").localeCompare(b.group?.name || "Ungrouped")
    );
  }, [deployments]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Deployments</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            Open a deployment to manage its environment, releases, source and endpoint.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setAddFolderOpen(true)} disabled={loading || !!busy} className="gc-button gc-button-primary"><Plus size={14} />Add project</button>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading || !!busy}
          className="gc-button gc-button-secondary"
        >
          <ScanLine size={14} aria-hidden="true" />
          {loading ? "Scanning…" : "Refresh discovery"}
        </button>
        </div>
      </div>

      {message && (
        <Notice tone={message.tone === "error" ? "danger" : message.tone}>
          {message.text}
        </Notice>
      )}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Your deployments</h3>
            <p className="mt-1 text-[11px] text-muted">Organized by project.</p>
          </div>
          <Link href="/projects" className="gc-button gc-button-quiet hidden sm:inline-flex">
            <Layers3 size={14} aria-hidden="true" />
            Projects
          </Link>
        </div>

        {loading ? (
          <div className="border border-border bg-card p-8 text-center text-sm text-muted">Reconciling host inventory…</div>
        ) : grouped.length === 0 ? (
          <div className="border border-dashed border-border p-8 text-center text-sm text-muted">
            No deployments yet. Open a project to connect an existing app or launch a new instance.
          </div>
        ) : grouped.map(({ group, items }) => (
          <div key={group?.id || "ungrouped"} className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <Link href={group ? `/projects/${group.slug}` : "/projects"} className="text-sm font-medium hover:text-accent">
                {group?.name || "Ungrouped"}
              </Link>
              <span className="font-mono text-[10px] text-muted">{items.length} deployment{items.length === 1 ? "" : "s"}</span>
            </div>
            <div className="divide-y divide-border/70">
              {items.map((item) => {
                const liveUrl = item.publicUrl || (item.domain ? `https://${item.domain}` : null);
                return (
                  <article key={item.id} className="grid gap-3 px-4 py-3 transition-colors hover:bg-background/35 md:grid-cols-[minmax(190px,1fr)_auto] md:items-center">
                    <Link href={`/deployments/${item.slug}`} className="group min-w-0">
                      <div className="truncate text-sm font-medium group-hover:text-accent">{item.name}</div>
                      <div className="mt-1 text-xs text-muted">{item.environmentName || "Unspecified"} · {item.kind === "compose" ? "Docker Compose" : item.kind}</div>
                      {item.observedStatus === "source-only" && <div className="mt-1 text-[11px] text-muted">Source added · not deployed</div>}
                      {item.observedStatus === "missing" && (
                        <div className="mt-1 text-[10px] text-warning">Needs attention</div>
                      )}
                    </Link>

                    <div className="flex items-center justify-end gap-1.5">
                      {liveUrl && (
                        <a
                          href={liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${item.name} live site`}
                          className="gc-icon-button"
                        >
                          <ExternalLink size={15} aria-hidden="true" />
                        </a>
                      )}
                      {item.repoUrl && (
                        <a
                          href={item.repoUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${item.name} repository`}
                          className="gc-icon-button"
                        >
                          <FolderGit2 size={15} aria-hidden="true" />
                        </a>
                      )}
                      <ContextActionMenu label={`Actions for ${item.name}`}>
                        {(close) => (
                          <>
                            <ContextMenuAction href={`/deployments/${item.slug}`}>
                              <ServerCog size={14} aria-hidden="true" />
                              Open deployment
                            </ContextMenuAction>
                            <ContextMenuAction href={liveUrl || `/deployments/${item.slug}`}>
                              <ExternalLink size={14} aria-hidden="true" />
                              {liveUrl ? "Open live site" : "Set live URL"}
                            </ContextMenuAction>
                            <ContextMenuAction href={item.repoUrl || `/deployments/${item.slug}`}>
                              <FolderGit2 size={14} aria-hidden="true" />
                              {item.repoUrl ? "Open repository" : "Set repository"}
                            </ContextMenuAction>
                            <ContextMenuDivider />
                            <ContextMenuAction onClick={() => {
                              close();
                              setLinkTarget({ type: "deployment", item });
                            }}>
                              <Link2 size={14} aria-hidden="true" />
                              Move to project
                            </ContextMenuAction>
                            <ContextMenuAction onClick={() => {
                              close();
                              setLinkTarget({ type: "deployment", item });
                              setNewProjectName("");
                            }}>
                              <Plus size={14} aria-hidden="true" />
                              Create project and link
                            </ContextMenuAction>
                            <ContextMenuDivider />
                            <ContextMenuAction
                              tone="danger"
                              disabled={busy === `unenroll-${item.id}`}
                              onClick={() => {
                                close();
                                void mutate(
                                  { action: "unenroll", deploymentId: item.id },
                                  `Stopping tracking for ${item.name}…`,
                                  `${item.name} is no longer tracked. Its files and containers were not changed.`,
                                  `unenroll-${item.id}`
                                );
                              }}
                            >
                              <Unlink size={14} aria-hidden="true" />
                              Stop tracking
                            </ContextMenuAction>
                          </>
                        )}
                      </ContextActionMenu>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Suggested from {localDesktop ? "this computer" : "this host"}</h3>
            <p className="mt-1 text-xs text-muted">Add what you want to manage. Dismissing a suggestion leaves its files and apps untouched.</p>
          </div>
          {hiddenCount > 0 && <button type="button" disabled={!!busy} onClick={() => void mutate({ action: "restore_all" }, "Restoring suggestions…", "Hidden suggestions restored.", "restore")} className="gc-button gc-button-quiet">Restore hidden ({hiddenCount})</button>}
        </div>
        {dismissed && <div role="status" className="flex flex-wrap items-center gap-3 text-xs text-muted"><span>{dismissed.name} dismissed.</span><button type="button" disabled={!!busy} className="gc-button gc-button-quiet" onClick={async () => { if (await mutate({ action: "restore", candidateId: dismissed.id }, "Restoring…", "Suggestion restored.", "undo")) setDismissed(null); }}>Undo</button></div>}
        {!loading && candidates.length === 0 ? (
          <div className="border border-dashed border-border p-6 text-center text-xs text-muted">
            No new suggestions. Use “Add project” to find projects in another folder.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {candidates.map((candidate) => (
              <article key={candidate.id} className="border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{candidate.name}</div>
                    <div className="mt-1 break-all font-mono text-[10px] text-muted">
                      {candidate.sourcePath || candidate.containerName}
                    </div>
                  </div>
                  <span className="border border-border bg-background px-2 py-1 font-mono text-[9px] text-muted">{candidate.kind === "source" ? "Source folder" : candidate.kind === "compose" ? "Compose app" : "Container"}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {candidate.evidence.map((entry) => (
                    <span key={entry} className="bg-background px-2 py-1 text-[10px] text-muted">{entry}</span>
                  ))}
                </div>
                {Boolean(candidate.services?.length) && <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer py-1">View {candidate.services!.length} service{candidate.services!.length === 1 ? "" : "s"}</summary><ul className="mt-2 space-y-2">{candidate.services!.map((service) => <li key={service.containerName} className="flex justify-between gap-2"><span className="min-w-0"><span className="block text-foreground">{service.name}</span><span className="block break-all text-[10px]">{service.image}</span></span><span>{service.state}</span></li>)}</ul></details>}
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                  <button type="button" disabled={!!busy} aria-label={`Dismiss ${candidate.name}`} className="gc-button gc-button-quiet mr-auto" onClick={async () => { if (await mutate({ action: "dismiss", candidateId: candidate.id }, `Dismissing ${candidate.name}…`, "Suggestion dismissed. Your files and apps are unchanged.", `dismiss-${candidate.id}`)) setDismissed(candidate); }}>Dismiss</button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void mutate(
                      { action: "enroll", ...candidate, projectId: null },
                      `Enrolling ${candidate.name} without moving its files…`,
                      `${candidate.name} enrolled. Its current location and runtime were preserved.`,
                      candidate.id
                    )}
                    className="gc-button gc-button-secondary"
                  >
                    {busy === candidate.id ? "Adding…" : candidate.kind === "source" ? "Add project" : "Track app"}
                  </button>
                  <ContextActionMenu label={`Enrollment options for ${candidate.name}`}>
                    {(close) => (
                      <>
                        <ContextMenuLabel>Enrollment</ContextMenuLabel>
                        <ContextMenuAction onClick={() => {
                          close();
                          setLinkTarget({ type: "candidate", item: candidate });
                        }}>
                          <Link2 size={14} aria-hidden="true" />
                          Enrol into project
                        </ContextMenuAction>
                        <ContextMenuAction onClick={() => {
                          close();
                          setLinkTarget({ type: "candidate", item: candidate });
                          setNewProjectName("");
                        }}>
                          <Plus size={14} aria-hidden="true" />
                          Create project and enrol
                        </ContextMenuAction>
                      </>
                    )}
                  </ContextActionMenu>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {addFolderOpen && <AddProjectFlow localDesktop={localDesktop} hostId={hostId} onClose={() => setAddFolderOpen(false)} onAdded={async (name) => { await load(); setMessage({ tone: "success", text: `${name} added to Projects. Its source is saved; no deployment has been started.` }); }} />}
      <ModalSurface
        open={Boolean(linkTarget)}
        onClose={() => {
          setLinkTarget(null);
          setNewProjectName("");
        }}
        title={linkTarget?.type === "candidate" ? "Enrol into a project" : "Move deployment"}
        description={linkTarget ? `Choose where ${linkTarget.item.name} belongs. This changes organization only; paths and runtime stay untouched.` : undefined}
      >
        <div className="space-y-5">
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => void linkTargetToProject(null)}
              className="flex w-full items-center justify-between border border-border px-3 py-2.5 text-left text-sm hover:border-accent/50 hover:bg-card"
            >
              <span>Ungrouped</span>
              <span className="font-mono text-[10px] text-muted">No project</span>
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => void linkTargetToProject(group.id)}
                className="flex w-full items-center justify-between border border-border px-3 py-2.5 text-left text-sm hover:border-accent/50 hover:bg-card"
              >
                <span>{group.name}</span>
                <span className="font-mono text-[10px] text-muted">{group.slug}</span>
              </button>
            ))}
          </div>

          <div className="border-t border-border pt-4">
            <label className="gc-label" htmlFor="new-project-name">Create a project and link</label>
            <div className="mt-2 flex gap-2">
              <input
                id="new-project-name"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="Project name"
                className="gc-field min-w-0 flex-1"
              />
              <button
                type="button"
                disabled={!newProjectName.trim() || !!busy}
                onClick={() => void createProjectAndLink()}
                className="gc-button gc-button-primary"
              >
                {busy === "create-and-link" ? "Creating…" : "Create & link"}
              </button>
            </div>
          </div>
        </div>
      </ModalSurface>
    </div>
  );
}
