"use client";
import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "./PageHeader";
type DomainReview = { reviewId: string; planHash: string; status: string; expiresAt: string; requiredTxt?: { name: string; value: string }; plan: { hostname: string; publicUrl: string; upstream: string; requiredDns: { type: string; name: string; content: string }; readyForPublishReview: boolean; warnings?: string[]; blockers: Array<{ field: string; message: string }> }; result?: { publicUrl?: string; error?: string }; error?: string };
async function read(response: Response) { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Domain request could not finish"); return data; }
export function AgentAppDomain({ deploymentId }: { deploymentId: string }) {
  const [hostname, setHostname] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [publishApproved, setPublishApproved] = useState(false);
  const [key, setKey] = useState("");
  const [review, setReview] = useState<DomainReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/agent-deployments/${encodeURIComponent(deploymentId)}/domain`;
  async function prepare() {
    setBusy(true); setError(""); setPublishApproved(false);
    const idempotencyKey = key || `domain-${crypto.randomUUID()}`;
    setKey(idempotencyKey);
    try { setReview(await fetch(`${base}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname, hostnameApproved: authorized, idempotencyKey }) }).then(read)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!review || !publishApproved) return;
    setBusy(true); setError("");
    try { const result = await fetch(`${base}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId: review.reviewId, planHash: review.planHash }) }).then(read); setReview({ ...review, ...result }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function refresh() {
    if (!review) return;
    setBusy(true); setError("");
    try { const result = await fetch(`${base}?reviewId=${encodeURIComponent(review.reviewId)}`, { cache: "no-store" }).then(read); setReview({ ...review, ...result }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const terminal = review && ["success", "failed", "uncertain"].includes(review.status);
  return <div className="gc-page mx-auto max-w-3xl space-y-6">
    <PageHeader eyebrow={`Deployment #${deploymentId}`} title="Give this application its own domain" description="Prepare DNS before launch, then publish after the isolated application passes its health check. GroundControl access and existing production routes stay unchanged." />
    {error && <p role="alert" className="rounded border border-error/30 bg-error/5 p-4 text-sm text-error">{error}</p>}
    <section className="space-y-4 rounded border border-border bg-card p-5">
      <label className="block text-sm">Application hostname<input className="mt-1 w-full rounded border border-border bg-background p-3 font-mono" placeholder="test.your-domain.com" value={hostname} disabled={busy || Boolean(review)} onChange={e => setHostname(e.target.value)} /></label>
      <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={authorized} disabled={busy || Boolean(review)} onChange={e => setAuthorized(e.target.checked)} /><span>I own this hostname or am authorized to use it for this isolated application. It is not my existing production or GroundControl hostname.</span></label>
      {!review && <button className="gc-button gc-button-primary" disabled={busy || !hostname || !authorized} onClick={() => void prepare()}>{busy ? "Checking requirements…" : "Prepare domain"}</button>}
      <p className="text-xs text-muted">No DNS, Azure network, firewall or proxy change happens during preparation. Cloudflare is not required. Existing Caddy and reachable ports 80/443 are checked, not installed or opened automatically.</p>
    </section>
    {review && <section className="space-y-4 rounded border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{review.plan.hostname}</h2>{review.status === "reviewed" && <button className="gc-button gc-button-quiet" disabled={busy} onClick={() => { setReview(null); setKey(""); setAuthorized(false); setPublishApproved(false); }}>Choose another hostname</button>}</div>
      <div className="rounded border border-border bg-background p-4 text-sm"><p>At your DNS provider, configure:</p><dl className="mt-3 space-y-3 font-mono text-xs"><div><dt>{review.plan.requiredDns.type} · {review.plan.requiredDns.name}</dt><dd className="mt-1 break-all">{review.plan.requiredDns.content}</dd></div>{review.requiredTxt && <div><dt>TXT · {review.requiredTxt.name}</dt><dd className="mt-1 break-all">{review.requiredTxt.value}</dd></div>}</dl></div>
      <p className="text-sm text-muted">The TXT record proves domain control. Use direct DNS for this check. Do not change an existing production record. A new isolated subdomain is the safest choice.</p>
      {review.plan.blockers.length > 0 && <div><h3 className="font-medium text-warning">Complete these steps first</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{review.plan.blockers.map((item, i) => <li key={i}>{item.message}</li>)}</ul></div>}
      {review.plan.warnings?.length ? <ul className="list-disc space-y-2 pl-5 text-sm text-warning">{review.plan.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul> : null}
      <p className="font-mono text-xs text-muted">Upstream: {review.plan.upstream} · status: {review.status}</p>
      {review.error && <p role="alert" className="text-sm text-error">{review.error}</p>}
      {!terminal && review.status === "reviewed" && <>
        <button className="gc-button gc-button-quiet" disabled={busy} onClick={() => void prepare()}>{busy ? "Checking…" : "Recheck DNS and prerequisites"}</button>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={publishApproved} onChange={e => setPublishApproved(e.target.checked)} /><span>Publish only this application route through the existing Caddy service, validate and reload its configuration, allow its required HTTP/HTTPS listeners on ports 80/443, and verify HTTPS. Do not change DNS, firewall rules, production routes or GroundControl identity.</span></label>
        <button className="gc-button gc-button-primary" disabled={busy || !publishApproved || !review.plan.readyForPublishReview} onClick={() => void publish()}>Publish and verify application HTTPS</button>
      </>}
      {review.status === "success" ? <p role="status" className="text-sm text-success">Application HTTPS verified from the server: <a href={review.plan.publicUrl} target="_blank" rel="noreferrer" className="underline">{review.plan.publicUrl}</a>. Open it from your browser to verify independent access and the real user journey.</p> : review.status !== "reviewed" && <><p className="text-sm text-muted">Inspect the operation before retrying. An uncertain result is not proof that nothing changed.</p><button className="gc-button gc-button-quiet" disabled={busy} onClick={() => void refresh()}>Refresh publication status</button></>}
    </section>}
    <Link href="/deployments" className="gc-button gc-button-quiet">Back to deployments</Link>
  </div>;
}
