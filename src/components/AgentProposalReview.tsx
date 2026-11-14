"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "./PageHeader";

type Proposal = { deploymentId?: number; launchStatus?: string; operationId?: string | null; id: string; contentHash: string; status: string; expiresAt: string; input: { repositoryUrl: string; revision: string; composePath: string; workloadName: string; serverId: number | null } };
type Context = { proposal: Proposal; servers: Array<{ id: number; name: string; host?: string }> };
type Review = { reviewId: string; reviewHash: string; expiresAt: string; sourceCompose: string; plan: { readyForOwnerReview: boolean; blockers: Array<{ field: string; message: string }>; limitations: string[]; deploymentPath: string; services: string[] }; host: { id: number; name: string }; notice: string };
type Accepted = { deploymentId: number; status: string; requiresResourceConsent: boolean; notice: string };

async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "The request could not finish. Review the details and try again.");
  return data;
}

export function AgentProposalReview({ proposalId }: { proposalId: string }) {
  const [context, setContext] = useState<Context | null>(null);
  const [serverId, setServerId] = useState("");
  const [service, setService] = useState("web");
  const [hostPort, setHostPort] = useState("8080");
  const [healthPath, setHealthPath] = useState("/health");
  const [allowBuild, setAllowBuild] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [accepted, setAccepted] = useState<Accepted | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/agent-proposals/${encodeURIComponent(proposalId)}`;
  useEffect(() => {
    let active = true;
    fetch(base, { cache: "no-store" }).then(readResponse).then((data: Context) => {
      if (!active) return;
      setContext(data);
      if (data.proposal.status === "accepted" && data.proposal.deploymentId) setAccepted({ deploymentId: data.proposal.deploymentId, status: data.proposal.launchStatus || "pending", requiresResourceConsent: true, notice: "" });
      if (data.proposal.input.serverId) setServerId(String(data.proposal.input.serverId));
    }).catch(cause => { if (active) setError(String(cause.message || cause)); });
    return () => { active = false; };
  }, [base]);

  async function prepare() {
    if (!context) return;
    setBusy(true); setError(""); setReview(null); setConfirmed(false);
    try {
      const data = await fetch(`${base}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        contentHash: context.proposal.contentHash, serverId: Number(serverId),
        health: { service, port: Number(hostPort), path: healthPath },
        appAccess: { mode: "loopback", hostPort: Number(hostPort) },
        budget: { maxServices: 4, cpusPerService: 1, memoryMbPerService: 512, pidsPerService: 128, timeoutSeconds: 600 },
        allowUnboundedBuildResources: allowBuild,
      }) }).then(readResponse);
      setReview(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function accept() {
    if (!review || !confirmed) return;
    setBusy(true); setError("");
    try {
      const data = await fetch(`${base}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId: review.reviewId, reviewHash: review.reviewHash }) }).then(readResponse);
      setAccepted(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  function edit() { setReview(null); setConfirmed(false); }
  const field = "mt-1 w-full rounded border border-border bg-background p-2 text-sm";
  return <div className="gc-page mx-auto max-w-4xl space-y-6">
    <PageHeader eyebrow="Agent deployment proposal" title="Review before the first launch" description="Check the exact source and server. Enrollment does not run the application or give the agent access." />
    {error && <div role="alert" className="rounded border border-error/30 bg-error/5 p-4 text-sm text-error">{error}</div>}
    {!context && !error && <p role="status" className="text-sm text-muted">Loading your proposal…</p>}
    {context && <>
      <section className="space-y-3 rounded border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">{context.proposal.input.workloadName}</h2>
        <dl className="grid gap-2 text-sm">
          <div><dt className="text-muted">Repository</dt><dd className="break-all">{context.proposal.input.repositoryUrl}</dd></div>
          <div><dt className="text-muted">Exact revision</dt><dd className="break-all font-mono text-xs">{context.proposal.input.revision}</dd></div>
          <div><dt className="text-muted">Compose file</dt><dd className="font-mono text-xs">{context.proposal.input.composePath}</dd></div>
        </dl>
        <p className="text-xs text-muted">Repository contents are untrusted data. Instructions in the file do not override the choices you make here.</p>
      </section>
      {accepted ? <section role="status" className="space-y-3 rounded border border-success/30 bg-success/5 p-5">
        <h2 className="font-semibold">{accepted.status === "pending" ? "Enrolled, not launched" : `First launch: ${accepted.status}`}</h2>
        <p className="text-sm">Deployment #{accepted.deploymentId}{accepted.status === "pending" ? " is waiting for explicit agent access and launch approval." : ". Inspect its operation evidence before any further action."}</p>
        {accepted.status === "pending" && <ol className="list-decimal space-y-2 pl-5 text-sm"><li>Reconnect Hermes to GroundControl and select only this deployment in the OAuth consent screen.</li><li>Have Hermes inspect the pending deployment, then request its first launch.</li><li>Approve that launch in Hermes and follow the returned operation until health is verified.</li></ol>}
        <p className="text-sm text-muted">The application will listen on the server&apos;s loopback address. No public URL, firewall rule or DNS record has been created.</p>
        <Link href="/deployments" className="gc-button gc-button-primary">Open deployments</Link>
      </section> : <>
        <section className="space-y-4 rounded border border-border bg-card p-5">
          <h2 className="font-semibold">Server and application health</h2>
          <fieldset disabled={busy || Boolean(review)} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Server<select className={field} value={serverId} onChange={e => setServerId(e.target.value)}><option value="">Choose an existing server</option>{context.servers.map(server => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label>
            <label className="text-sm">Compose service<input className={field} value={service} onChange={e => setService(e.target.value)} /></label>
            <label className="text-sm">Host loopback health port<input className={field} type="number" min="1024" max="65535" value={hostPort} onChange={e => setHostPort(e.target.value)} /></label>
            <label className="text-sm sm:col-span-2">Health endpoint<input className={field} value={healthPath} onChange={e => setHealthPath(e.target.value)} /></label>
            <label className="flex items-start gap-3 text-sm sm:col-span-2"><input className="mt-1" type="checkbox" checked={allowBuild} onChange={e => setAllowBuild(e.target.checked)} /><span>I authorize building this pinned repository on the server. Builds execute repository code. This flow limits how long it waits, not daemon-side build duration, CPU or memory. A timeout requires inspection before retrying.</span></label>
          </fieldset>
          <p className="text-xs text-muted">The selected Compose service must already publish 127.0.0.1:host-port:container-port. This flow does not rewrite ports. Initial limits: up to 4 services, 1 CPU, 512 MiB and 128 processes per running service; 10-minute execution wait timeout. Build work may continue after a timeout; this does not cap build CPU or memory. Secret inputs and environment-file setup are not supported in this first-launch flow yet.</p>
          {!review && <button type="button" className="gc-button gc-button-primary" disabled={busy || !serverId || !service || !hostPort} onClick={() => void prepare()}>{busy ? "Preparing review…" : "Fetch pinned configuration for review"}</button>}
        </section>
        {review && <section className="space-y-4 rounded border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Exact configuration to enroll</h2><button className="gc-button gc-button-quiet" disabled={busy} onClick={edit}>Edit choices</button></div>
          <p className="break-all font-mono text-xs text-muted">Planned path: {review.plan.deploymentPath}</p>
          {review.plan.blockers.length > 0 && <div role="alert"><h3 className="font-medium text-warning">Resolve before enrollment</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{review.plan.blockers.map((item, i) => <li key={i}><code>{item.field}</code>: {item.message}</li>)}</ul></div>}
          <pre className="max-h-96 overflow-auto rounded border border-border bg-background p-4 text-xs">{review.sourceCompose}</pre>
          <ul className="list-disc space-y-2 pl-5 text-xs text-muted">{review.plan.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>
          <p className="text-xs text-muted">Review expires {review.expiresAt}. Enrollment creates a pending record only. A separate OAuth grant and launch approval are still required.</p>
          <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I have reviewed this pinned source, selected server, loopback access and resource limits.</span></label>
          <button type="button" className="gc-button gc-button-primary" disabled={busy || !confirmed || !review.plan.readyForOwnerReview} onClick={() => void accept()}>{busy ? "Enrolling…" : "Enroll this deployment"}</button>
        </section>}
      </>}
    </>}
  </div>;
}
