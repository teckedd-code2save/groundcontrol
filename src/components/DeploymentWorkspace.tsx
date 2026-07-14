"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectsPanel } from "@/components/ProjectsPanel";

type Group = { id: number; name: string; slug: string; description: string };
type Candidate = {
  id: string; kind: string; name: string; sourcePath?: string | null; composePath?: string | null;
  containerName?: string | null; state?: string; image?: string; components?: number; evidence: string[];
};
type Enrolled = {
  id: number; name: string; slug: string; kind: string; managementMode: string; sourcePath?: string | null;
  containerName?: string | null; projectId?: number | null; project?: Group | null; observedStatus: string;
};

async function readJson(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { error: text || "Invalid response" }; }
}

export function DeploymentWorkspace() {
  const [view, setView] = useState<"inventory" | "operations">("inventory");
  const [groups, setGroups] = useState<Group[]>([]);
  const [deployments, setDeployments] = useState<Enrolled[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [projectName, setProjectName] = useState("");
  const [candidateProjects, setCandidateProjects] = useState<Record<string, string>>({});
  const [openActions, setOpenActions] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetch("/api/deployment-inventory").then(readJson);
    if (data.error) setMessage(data.error);
    else {
      setGroups(data.projects || []);
      setDeployments(data.deployments || []);
      setCandidates(data.candidates || []);
      setMessage(data.discoveryError || "");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function mutate(body: Record<string, unknown>) {
    const response = await fetch("/api/deployment-inventory", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await readJson(response);
    if (!response.ok || data.error) setMessage(data.error || "Action failed");
    else { setMessage(""); await load(); }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, { group: Group | null; items: Enrolled[] }>();
    for (const deployment of deployments) {
      const key = deployment.project ? String(deployment.project.id) : "ungrouped";
      const current = map.get(key) || { group: deployment.project || null, items: [] };
      current.items.push(deployment);
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => (a.group?.name || "Ungrouped").localeCompare(b.group?.name || "Ungrouped"));
  }, [deployments]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Deployment control plane</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">Projects are lightweight groups. Deployments are enrolled from the host and remain where they already run.</p>
        </div>
        <div className="flex rounded-lg bg-card p-1 text-xs font-mono">
          <button onClick={() => setView("inventory")} className={`rounded-md px-3 py-1.5 ${view === "inventory" ? "bg-background text-foreground" : "text-muted"}`}>Inventory</button>
          <button onClick={() => setView("operations")} className={`rounded-md px-3 py-1.5 ${view === "operations" ? "bg-background text-foreground" : "text-muted"}`}>Operations</button>
        </div>
      </div>

      {view === "operations" ? <ProjectsPanel /> : (
        <>
          {message && <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">{message}</div>}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h3 className="text-sm font-medium">Projects</h3><p className="mt-1 text-[11px] text-muted">Groups only—no paths, environment, or runtime configuration.</p></div>
              <div className="flex gap-2">
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="New project" className="rounded-md bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent" />
                <button onClick={async () => { if (!projectName.trim()) return; await mutate({ action: "create_project", name: projectName }); setProjectName(""); }} className="rounded-md bg-foreground px-3 py-2 text-xs text-background">Create project</button>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div><h3 className="text-sm font-medium">Enrolled deployments</h3><p className="mt-1 text-[11px] text-muted">Stable workloads tracked independently from their release history.</p></div>
            {loading ? <div className="rounded-xl bg-card p-8 text-center text-sm text-muted">Reconciling host inventory…</div> : grouped.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">No deployments enrolled yet. Review the discoveries below.</div> : grouped.map(({ group, items }) => (
              <div key={group?.id || "ungrouped"} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="text-sm font-medium">{group?.name || "Ungrouped"}</span><span className="font-mono text-[10px] text-muted">{items.length} deployment{items.length === 1 ? "" : "s"}</span></div>
                {items.map((item) => (
                  <div key={item.id} className="grid gap-3 border-b border-border/60 px-4 py-3 last:border-0 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] md:items-center">
                    <div><div className="text-sm font-medium">{item.name}</div><div className="mt-1 font-mono text-[10px] text-muted">{item.kind} · {item.managementMode}</div></div>
                    <div className="min-w-0"><div className={`text-xs ${item.observedStatus === "present" ? "text-success" : "text-warning"}`}>{item.observedStatus}</div><div className="mt-1 truncate font-mono text-[10px] text-muted">{item.sourcePath || item.containerName || "runtime identity"}</div></div>
                    <div className="relative">
                      <button onClick={() => setOpenActions(openActions === item.id ? null : item.id)} className="rounded-md border border-border px-3 py-1.5 text-xs font-mono text-muted hover:text-foreground">Actions</button>
                      {openActions === item.id && <div className="absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-lg border border-border bg-background shadow-xl">
                        <label className="block border-b border-border p-2 text-[10px] font-mono text-muted">Project<select value={item.projectId || ""} onChange={(event) => mutate({ action: "assign_project", deploymentId: item.id, projectId: event.target.value || null })} className="mt-1 w-full rounded bg-card px-2 py-1.5 text-xs text-foreground"><option value="">Ungrouped</option>{groups.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
                        <button onClick={() => mutate({ action: "unenroll", deploymentId: item.id })} className="w-full px-3 py-2 text-left text-xs text-error hover:bg-error/10">Stop tracking</button>
                      </div>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <div><h3 className="text-sm font-medium">Discovered on this host</h3><p className="mt-1 text-[11px] text-muted">Nothing is treated as a deployment until you enrol it.</p></div>
            <div className="grid gap-3 lg:grid-cols-2">
              {candidates.map((candidate) => (
                <div key={candidate.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-medium">{candidate.name}</div><div className="mt-1 font-mono text-[10px] text-muted">{candidate.kind} · {candidate.sourcePath || candidate.containerName}</div></div><span className="rounded bg-background px-2 py-1 font-mono text-[9px] uppercase text-muted">candidate</span></div>
                  <div className="mt-3 flex flex-wrap gap-1.5">{candidate.evidence.map((entry) => <span key={entry} className="rounded bg-background px-2 py-1 text-[10px] text-muted">{entry}</span>)}</div>
                  <div className="mt-4 flex gap-2"><select value={candidateProjects[candidate.id] || ""} onChange={(event) => setCandidateProjects({ ...candidateProjects, [candidate.id]: event.target.value })} className="min-w-0 flex-1 rounded-md bg-background px-2 py-2 text-xs"><option value="">Ungrouped</option>{groups.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button onClick={() => mutate({ action: "enroll", ...candidate, projectId: candidateProjects[candidate.id] || null })} className="rounded-md bg-accent px-3 py-2 text-xs text-background">Enrol</button></div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
