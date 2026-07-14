"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DeploymentEnvPanel } from "@/components/DeploymentEnvPanel";

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
  evidence: string[];
};
type Enrolled = {
  id: number;
  name: string;
  slug: string;
  kind: string;
  managementMode: string;
  sourcePath?: string | null;
  containerName?: string | null;
  projectId?: number | null;
  project?: Group | null;
  legacyProjectId?: number | null;
  legacyProjectSlug?: string | null;
  observedStatus: string;
};

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
  const [projectName, setProjectName] = useState("");
  const [candidateProjects, setCandidateProjects] = useState<Record<string, string>>({});
  const [openActions, setOpenActions] = useState<number | null>(null);
  const [expandedDeployment, setExpandedDeployment] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const load = useCallback(async (announce = false) => {
    setLoading(true);
    if (announce) setMessage({ tone: "info", text: "Scanning the active host for folders and containers…" });
    try {
      const data = await fetch("/api/deployment-inventory", { cache: "no-store" }).then(readJson);
      if (data.error) throw new Error(data.error);
      setGroups(data.projects || []);
      setDeployments(data.deployments || []);
      setCandidates(data.candidates || []);
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

  async function mutate(body: Record<string, unknown>, pending: string, success: string, busyKey: string) {
    setBusy(busyKey);
    setMessage({ tone: "info", text: pending });
    try {
      const response = await fetch("/api/deployment-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Action failed");
      await load();
      setMessage({ tone: "success", text: success });
      setOpenActions(null);
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function redeploy(item: Enrolled, component?: string) {
    if (!item.legacyProjectSlug) return;
    const scope = component ? `${item.name} / ${component}` : item.name;
    setBusy(`redeploy-${item.id}`);
    setMessage({ tone: "info", text: `Redeploying ${scope} with its managed environment…` });
    try {
      const response = await fetch("/api/projects/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug: item.legacyProjectSlug,
          action: "redeploy",
          services: component ? [component] : undefined,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error || data.success === false) {
        throw new Error(data.error || "Redeploy failed");
      }
      setMessage({ tone: "success", text: `${scope} redeployed with the synchronized environment.` });
      await load();
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Active host inventory</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">Deployments</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            A deployment is a folder or standalone container you explicitly enrol. Release history, runtime controls,
            environment and evidence stay attached to that identity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading || !!busy}
          className="rounded-md border border-border px-3 py-2 text-xs font-mono text-muted hover:border-accent/50 hover:text-accent disabled:opacity-50"
        >
          {loading ? "Scanning…" : "Scan host"}
        </button>
      </div>

      {message && (
        <div className={`rounded-md border px-3 py-2 text-xs ${
          message.tone === "success"
            ? "border-success/30 bg-success/10 text-success"
            : message.tone === "error"
              ? "border-error/30 bg-error/10 text-error"
              : "border-border bg-card text-muted"
        }`}>
          {message.text}
        </div>
      )}

      <section className="border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-sm font-medium">Projects</h3>
            <p className="mt-1 text-[11px] text-muted">Optional groups only. They do not own paths, configuration or runtime.</p>
          </div>
          <div className="flex gap-2">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name"
              className="rounded-md bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              disabled={!projectName.trim() || !!busy}
              onClick={async () => {
                const name = projectName.trim();
                const ok = await mutate(
                  { action: "create_project", name },
                  `Creating project “${name}”…`,
                  `Project “${name}” created.`,
                  "create-project"
                );
                if (ok) setProjectName("");
              }}
              className="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-50"
            >
              {busy === "create-project" ? "Creating…" : "Create project"}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Enrolled deployments</h3>
          <p className="mt-1 text-[11px] text-muted">Open a deployment to manage its current environment and runtime context.</p>
        </div>
        {loading ? (
          <div className="border border-border bg-card p-8 text-center text-sm text-muted">Reconciling host inventory…</div>
        ) : grouped.length === 0 ? (
          <div className="border border-dashed border-border p-8 text-center text-sm text-muted">
            No deployments enrolled. Choose one of the discovered workloads below.
          </div>
        ) : grouped.map(({ group, items }) => (
          <div key={group?.id || "ungrouped"} className="overflow-hidden border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-medium">{group?.name || "Ungrouped"}</span>
              <span className="font-mono text-[10px] text-muted">{items.length} deployment{items.length === 1 ? "" : "s"}</span>
            </div>
            {items.map((item) => {
              const expanded = expandedDeployment === item.id;
              return (
                <div key={item.id} className="border-b border-border/60 last:border-0">
                  <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] md:items-center">
                    <button
                      type="button"
                      onClick={() => setExpandedDeployment(expanded ? null : item.id)}
                      className="min-w-0 text-left"
                    >
                      <div className="text-sm font-medium">{item.name}</div>
                      <div className="mt-1 font-mono text-[10px] text-muted">{item.kind} · {item.managementMode}</div>
                    </button>
                    <div className="min-w-0">
                      <div className={`text-xs ${item.observedStatus === "present" ? "text-success" : "text-warning"}`}>
                        {item.observedStatus === "present" ? "Observed on host" : "Not found in latest scan"}
                      </div>
                      <div className="mt-1 truncate font-mono text-[10px] text-muted">{item.sourcePath || item.containerName || "runtime identity"}</div>
                    </div>
                    <div className="relative flex gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedDeployment(expanded ? null : item.id)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-mono text-muted hover:text-foreground"
                      >
                        {expanded ? "Close" : "Manage"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenActions(openActions === item.id ? null : item.id)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-mono text-muted hover:text-foreground"
                      >
                        More
                      </button>
                      {openActions === item.id && (
                        <div className="absolute right-0 top-9 z-20 w-52 overflow-hidden border border-border bg-background shadow-xl">
                          <label className="block border-b border-border p-2 text-[10px] font-mono text-muted">
                            Project
                            <select
                              value={item.projectId || ""}
                              onChange={(event) => void mutate(
                                { action: "assign_project", deploymentId: item.id, projectId: event.target.value || null },
                                `Moving ${item.name}…`,
                                `${item.name} moved.`,
                                `assign-${item.id}`
                              )}
                              className="mt-1 w-full rounded bg-card px-2 py-1.5 text-xs text-foreground"
                            >
                              <option value="">Ungrouped</option>
                              {groups.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => void mutate(
                              { action: "unenroll", deploymentId: item.id },
                              `Stopping tracking for ${item.name}…`,
                              `${item.name} is no longer tracked. Its files and containers were not changed.`,
                              `unenroll-${item.id}`
                            )}
                            className="w-full px-3 py-2 text-left text-xs text-error hover:bg-error/10"
                          >
                            Stop tracking
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-t border-border bg-background/40 px-4 py-4">
                      {item.legacyProjectId ? (
                        <DeploymentEnvPanel
                          projectId={item.legacyProjectId}
                          onRedeploy={(component) => void redeploy(item, component)}
                        />
                      ) : (
                        <div className="flex flex-col gap-3 text-xs text-muted md:flex-row md:items-center md:justify-between">
                          <span>This standalone container has no saved deployment source yet. Runtime actions remain available in Runtime.</span>
                          <a href="/containers" className="shrink-0 rounded-md border border-border px-3 py-2 font-mono text-foreground hover:border-accent/50 hover:text-accent">Open runtime</a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Discovered on this host</h3>
          <p className="mt-1 text-[11px] text-muted">Candidates are evidence only. GroundControl will not manage them until you enrol them.</p>
        </div>
        {!loading && candidates.length === 0 ? (
          <div className="border border-dashed border-border p-6 text-center text-xs text-muted">No un-enrolled folders or containers found in the configured discovery locations.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {candidates.map((candidate) => (
              <div key={candidate.id} className="border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{candidate.name}</div>
                    <div className="mt-1 truncate font-mono text-[10px] text-muted">{candidate.kind} · {candidate.sourcePath || candidate.containerName}</div>
                  </div>
                  <span className="bg-background px-2 py-1 font-mono text-[9px] uppercase text-muted">candidate</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {candidate.evidence.map((entry) => <span key={entry} className="bg-background px-2 py-1 text-[10px] text-muted">{entry}</span>)}
                </div>
                <div className="mt-4 flex gap-2">
                  <select
                    value={candidateProjects[candidate.id] || ""}
                    onChange={(event) => setCandidateProjects({ ...candidateProjects, [candidate.id]: event.target.value })}
                    className="min-w-0 flex-1 rounded-md bg-background px-2 py-2 text-xs"
                  >
                    <option value="">Ungrouped</option>
                    {groups.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void mutate(
                      { action: "enroll", ...candidate, projectId: candidateProjects[candidate.id] || null },
                      `Enrolling ${candidate.name} without moving its files…`,
                      `${candidate.name} enrolled. Its current location and runtime were preserved.`,
                      candidate.id
                    )}
                    className="rounded-md bg-accent px-3 py-2 text-xs text-background disabled:opacity-50"
                  >
                    {busy === candidate.id ? "Enrolling…" : "Enrol"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
