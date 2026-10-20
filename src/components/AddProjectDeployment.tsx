"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Link2, Rocket } from "lucide-react";
import { ModalSurface } from "./ModalSurface";
import { Notice } from "./ui";

export type ProjectDeployment = { id: number; name: string; slug: string; environmentName: string; method: string; hostName: string; hostId?: number | null; publicUrl?: string | null; status: string; projectName?: string };
type Candidate = { id: string; name: string; kind: string; services?: { state: string }[] };
export function AddProjectDeployment({ project, deployments, connection, onClose, onAdded }: {
  project: { id: number; name: string }; deployments: ProjectDeployment[];
  connection: { hostId?: number | null; hostName?: string; localDesktop?: boolean };
  onClose: () => void; onAdded: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"choose" | "connect" | "launch">("choose");
  const [environment, setEnvironment] = useState(connection.localDesktop ? "Local" : "Production");
  const [launchName, setLaunchName] = useState(`${project.name} local`);
  const [image, setImage] = useState("");
  const [port, setPort] = useState("80");
  const [review, setReview] = useState(false);
  const [selected, setSelected] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useEffect(() => {
    if (mode !== "connect") return;
    let cancelled = false; setLoading(true); setError("");
    fetch("/api/deployment-inventory").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (data.hostId !== connection.hostId) throw new Error("Connection changed. Close this dialog and refresh Projects."); if (!cancelled) setCandidates((data.candidates || []).filter((item: Candidate) => item.kind !== "source")); })
      .catch((error) => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mode, connection.hostId]);
  async function connect() {
    setBusy(true); setError("");
    try {
      const tracked = selected.startsWith("tracked:");
      const response = await fetch(tracked ? `/api/projects/${selected.slice(8)}/group` : "/api/deployment-inventory", { method: tracked ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tracked ? { projectGroupId: project.id, environmentName: environment } : { action: "enroll", candidateId: selected, projectId: project.id, environmentName: environment, hostId: connection.hostId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not connect deployment.");
      await onAdded(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function launchLocal() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/deployment-inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "launch_local", projectId: project.id, environmentName: environment, hostId: connection.hostId, name: launchName, image, containerPort: Number(port) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not launch deployment.");
      await onAdded(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  const launchUrl = `/templates?projectId=${project.id}&environment=${encodeURIComponent(environment)}&hostId=${connection.hostId ?? ""}`;
  return <ModalSurface open onClose={close} title={`Add deployment to ${project.name}`} description="A deployment is one running instance of this project, in an environment you choose." footer={<>
    <button className="gc-button gc-button-quiet" disabled={busy} onClick={onClose}>Cancel</button>
    {mode === "connect" && <button className="gc-button gc-button-primary" disabled={!selected || !environment.trim() || busy || loading} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect deployment"}</button>}
    {mode === "launch" && !connection.localDesktop && environment.trim() && connection.hostId && <Link href={launchUrl} className="gc-button gc-button-primary">Choose a template →</Link>}
    {mode === "launch" && connection.localDesktop && <button className="gc-button gc-button-primary" disabled={busy || !environment.trim() || !image.trim() || !launchName.trim() || !port} onClick={() => review ? void launchLocal() : setReview(true)}>{busy ? "Launching…" : review ? "Launch deployment" : "Review deployment"}</button>}
  </>}>
    {error && <div role="alert" className="mb-4"><Notice tone="danger">{error}</Notice></div>}
    {mode === "choose" ? <div className="space-y-3">
      <button className="flex w-full gap-4 border border-border p-5 text-left hover:border-accent" onClick={() => setMode("connect")}><Link2 size={21} className="shrink-0 text-accent" /><span><strong className="block text-sm">Connect an existing deployment</strong><span className="mt-1 block text-xs leading-relaxed text-muted">Add an app already running on a connected host, or move a tracked deployment into this project.</span></span></button>
      <button className="flex w-full gap-4 border border-border p-5 text-left hover:border-accent" onClick={() => setMode("launch")}><Rocket size={21} className="shrink-0 text-accent" /><span><strong className="block text-sm">Launch a new deployment</strong><span className="mt-1 block text-xs leading-relaxed text-muted">Configure a new instance, then review before deploying.</span></span></button>
    </div> : <div className="space-y-4">
      <button className="gc-button gc-button-quiet" disabled={busy} onClick={() => { setMode("choose"); setError(""); }}><ArrowLeft size={14} />Back</button>
      <label className="block"><span className="gc-label">Environment</span><input className="gc-field mt-2 w-full" list="project-environments" maxLength={60} disabled={busy} value={environment} onChange={(event) => { setEnvironment(event.target.value); setReview(false); }} /><datalist id="project-environments"><option>Local</option><option>Development</option><option>Staging</option><option>Production</option></datalist></label>
      {mode === "launch" && connection.localDesktop && <div className="space-y-4">
        <p className="text-xs leading-relaxed text-muted">Run a ready-to-use Docker image on this computer. For source builds, multiple services, or custom configuration, choose a Linux server and a template.</p>
        <label className="block"><span className="gc-label">Deployment name</span><input disabled={busy} className="gc-field mt-2 w-full" value={launchName} onChange={(e) => { setLaunchName(e.target.value); setReview(false); }} /></label>
        <label className="block"><span className="gc-label">Docker image</span><input disabled={busy} className="gc-field mt-2 w-full" value={image} placeholder="nginx:alpine" onChange={(e) => { setImage(e.target.value); setReview(false); }} /></label>
        <label className="block"><span className="gc-label">App port inside the container</span><input disabled={busy} type="number" min="1" max="65535" className="gc-field mt-2 w-full" value={port} onChange={(e) => { setPort(e.target.value); setReview(false); }} /></label>
        {review && <Notice>Launch {launchName} using {image} for {project.name} / {environment}. Docker will assign a free local address, accessible only on this computer.</Notice>}
      </div>}
      {mode === "launch" ? <div className="border border-border bg-card p-4 text-sm"><p>Launch on <strong>{connection.hostName || "your active connection"}</strong></p><p className="mt-2 text-xs leading-relaxed text-muted">Your project and environment will be saved with the new deployment. Choose a different host in <Link href="/settings?tab=connections" className="text-accent underline">Connections</Link> before continuing.</p></div> : <>
        <p className="text-xs text-muted">Tracked deployments can be moved here. New discoveries are from {connection.hostName || "the active connection"}.</p>
        {loading && <p role="status" className="text-sm text-muted">Looking for running apps…</p>}
        <fieldset disabled={busy || loading} className="max-h-64 space-y-2 overflow-auto"><legend className="sr-only">Choose deployment</legend>
          {deployments.map((item) => <label key={item.id} className="flex gap-3 border border-border p-3"><input type="radio" name="deployment" checked={selected === `tracked:${item.id}`} onChange={() => { setSelected(`tracked:${item.id}`); if (item.environmentName !== "Unspecified") setEnvironment(item.environmentName); }} /><span className="text-sm">{item.name}<span className="mt-1 block text-xs text-muted">{item.environmentName} · {item.hostName} · {item.projectName ? `Move from ${item.projectName}` : "No project yet"}</span></span></label>)}
          {candidates.map((item) => <label key={item.id} className="flex gap-3 border border-border p-3"><input type="radio" name="deployment" checked={selected === item.id} onChange={() => setSelected(item.id)} /><span className="text-sm">{item.name}<span className="mt-1 block text-xs text-muted">{item.kind === "compose" ? "Docker Compose" : "Container"} · {item.services?.length || 1} service(s) · Discovered</span></span></label>)}
          {!loading && !deployments.length && !candidates.length && <p className="border border-dashed border-border p-4 text-sm text-muted">No available deployments. You can launch a new instance or switch connections.</p>}
        </fieldset>
      </>}
    </div>}
  </ModalSurface>;
}
