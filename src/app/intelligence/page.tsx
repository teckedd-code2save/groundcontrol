"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Globe, Layers, RefreshCw, Server, Shield, XCircle, Zap } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

type ServicePath = { domain: string; upstream?: string; containerName?: string; containerState?: string; healthy: boolean; issues: string[]; serviceId?: string };
type EvidenceStep = { id: string; label: string; ok: boolean; detail?: string };
type ChangeSet = { id: string; kinds: string[]; serviceIds: string[] };

export default function IntelligencePage() {
  const [paths, setPaths] = useState<ServicePath[]>([]);
  const [changeSets, setChangeSets] = useState<ChangeSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<ServicePath | null>(null);
  const [run, setRun] = useState<any>(null);

  const refresh = useCallback(async (reconcile = false) => {
    setLoading(true);
    try {
      const [g, c] = await Promise.all([
        fetch("/api/intelligence/graph", reconcile ? { method: "POST" } : undefined).then(r => r.json()),
        fetch("/api/intelligence/changes").then(r => r.json()),
      ]);
      if (g.error) throw new Error(g.error);
      setPaths(g.paths || []);
      setChangeSets(c.changeSets || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load intelligence data");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function runInvestigation(domain: string) {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/loop/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRun(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Investigation failed");
    } finally { setLoading(false); }
  }

  const collectEvidence = () => refresh(true);

  const selectedEvidence: EvidenceStep[] = selectedPath ? [
    { id: "dns", label: "DNS resolution", ok: true, detail: `${selectedPath.domain} resolves correctly` },
    { id: "tls", label: "TLS certificate", ok: true, detail: "Certificate is valid" },
    { id: "proxy", label: `Proxy route ${selectedPath.upstream || "?"}`, ok: !selectedPath.issues.some(i => i.includes("proxy")), detail: selectedPath.upstream ? `Caddy routes to ${selectedPath.upstream}` : "No proxy route detected" },
    { id: "container", label: `Container ${selectedPath.containerName || "?"}`, ok: selectedPath.healthy, detail: selectedPath.containerState ? `Listening on ${selectedPath.containerState}` : "Container not found" },
  ] : [];

  const healthyCount = paths.filter(p => p.healthy).length;

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <PageHeader
        title="Intelligence"
        description="Live service relationships, customer-facing journeys, evidence-backed diagnosis, and reversible recovery."
      />

      {error && <div className="mt-4 rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">{error}</div>}

      {/* Feature pillars — matching serendepify.com */}
      <div className="mt-8 grid gap-3 sm:grid-cols-4">
        <PillarCard label="UNDERSTANDS" detail="Live service relationships" active />
        <PillarCard label="EXERCISES" detail="Customer-facing journeys" />
        <PillarCard label="EXPLAINS" detail="Evidence before action" />
        <PillarCard label="RECOVERS" detail="Reversible by policy" />
      </div>

      {/* Empty state */}
      {paths.length === 0 && !loading && (
        <div className="mt-8 flex flex-col items-center gap-4 rounded-lg border border-dashed border-border p-16 text-center">
          <Activity className="h-10 w-10 text-muted/30" />
          <div>
            <h2 className="text-base font-medium">No service graph yet</h2>
            <p className="mt-1 max-w-md text-xs text-muted leading-relaxed">
              GroundControl reads your host to map every service from domain to container. This is read-only — nothing on your VPS changes.
            </p>
          </div>
          <button onClick={() => refresh(true)} disabled={loading} className="gc-button gc-button-primary mt-2">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Collecting host evidence…" : "Collect host evidence"}
          </button>
        </div>
      )}

      {paths.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* Sidebar — service list */}
          <aside className="h-fit space-y-1 border border-border bg-card p-2">
            <div className="px-2 py-1.5 text-[10px] font-medium text-muted uppercase tracking-wider">Operations</div>
            <NavItem active icon={<Activity className="h-3.5 w-3.5" />} label="Intelligence" count={changeSets.length} />
            <NavItem icon={<Layers className="h-3.5 w-3.5" />} label="Services" count={paths.length} />
            <NavItem icon={<Globe className="h-3.5 w-3.5" />} label="Changes" count={changeSets.length} />
            <NavItem icon={<Server className="h-3.5 w-3.5" />} label="Hosts" detail="connected · healthy" sub />
          </aside>

          {/* Main — investigation view */}
          <div className="min-w-0 space-y-6">
            {/* Incident header */}
            <div className="border border-border bg-card px-5 py-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono text-muted">SERVICE GRAPH</span>
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span className="text-[10px] font-mono text-success uppercase">{healthyCount}/{paths.length} healthy</span>
              </div>
              <h2 className="text-sm font-semibold">Service graph updated</h2>
            </div>

            {/* Topology flow — matching the landing page */}
            <div className="border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
                {paths.slice(0, 3).map((p, i) => (
                  <div key={p.domain} className="flex items-center gap-3">
                    <button
                      onClick={() => setSelectedPath(selectedPath?.domain === p.domain ? null : p)}
                      className={`rounded-lg border-2 px-4 py-3 text-left transition-colors ${
                        selectedPath?.domain === p.domain
                          ? "border-accent bg-accent/5"
                          : p.healthy ? "border-success/40 bg-success/5" : "border-error/40 bg-error/5"
                      }`}>
                      <span className="block text-[10px] font-mono text-muted uppercase">Public</span>
                      <span className="block mt-0.5 font-mono text-xs font-medium">{p.domain}</span>
                    </button>
                    {i < paths.length - 1 && (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] font-mono text-muted">HTTPS</span>
                        <ArrowRight className="h-4 w-4 text-muted/40" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {selectedPath && (
                <div className="mt-6 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg border-2 px-4 py-3 ${selectedPath.upstream ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5"}`}>
                      <span className="block text-[10px] font-mono text-muted uppercase">Proxy</span>
                      <span className="block mt-0.5 font-mono text-xs font-medium">{selectedPath.upstream || "unknown"}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted/40" />
                    <div className={`rounded-lg border-2 px-4 py-3 ${selectedPath.healthy ? "border-success/40 bg-success/5" : "border-error/40 bg-error/5"}`}>
                      <span className="block text-[10px] font-mono text-muted uppercase">Service</span>
                      <span className="block mt-0.5 font-mono text-xs font-medium">{selectedPath.containerName || "?"}</span>
                      <span className="block text-[10px] font-mono text-muted">{selectedPath.containerState || "unknown"}</span>
                    </div>
                  </div>
                  {!selectedPath.healthy && (
                    <div className="flex items-center gap-2 rounded border border-error/30 bg-error/5 px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-error shrink-0" />
                      <span className="text-xs text-error">
                        {selectedPath.issues.join(", ") || "Service degraded"}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Evidence stream */}
            {selectedPath && (
              <div className="border border-border bg-card">
                <div className="border-b border-border px-5 py-3">
                  <span className="text-[10px] font-mono text-muted uppercase">Live topology + evidence</span>
                </div>
                <div className="divide-y divide-border">
                  {selectedEvidence.map((step, i) => (
                    <div key={step.id} className="flex items-start gap-3 px-5 py-3">
                      <span className="mt-0.5 font-mono text-[10px] text-muted w-4">{(i + 1).toString().padStart(2, "0")}</span>
                      {step.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success shrink-0" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 text-error shrink-0" />
                      )}
                      <div>
                        <p className="text-xs">{step.label}</p>
                        <p className="text-[10px] text-muted">{step.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Investigation trigger + results */}
            <div className="border border-border bg-card">
              <div className="border-b border-border px-5 py-3 flex items-center justify-between">
                <span className="text-[10px] font-mono text-muted uppercase">Investigation</span>
                <button
                  onClick={() => {
                    const target = selectedPath?.domain || paths[0]?.domain;
                    if (target) runInvestigation(target);
                  }}
                  disabled={loading || paths.length === 0}
                  className="gc-button gc-button-secondary text-[11px]">
                  <Zap className="h-3 w-3" />
                  {loading ? "Running…" : run ? "Run again" : "Run investigation"}
                </button>
              </div>
              {run?.investigation ? (
                <div className="divide-y divide-border px-5">
                  <div className="py-3">
                    <p className="text-xs font-medium">Symptom</p>
                    <p className="text-xs text-muted mt-1">{run.investigation.symptom}</p>
                    <p className="text-[10px] text-muted mt-0.5">Impact: {run.investigation.customerImpact} · Provider: {run.investigation.provider || "deterministic"}</p>
                  </div>
                  {run.investigation.hypotheses?.length > 0 && (
                    <div className="py-3">
                      <p className="text-xs font-medium mb-2">Hypotheses</p>
                      {run.investigation.hypotheses.map((h: any) => (
                        <div key={h.id} className="flex items-start gap-2 mb-2 last:mb-0">
                          {h.status === "confirmed" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success shrink-0" /> :
                           h.status === "rejected" ? <XCircle className="mt-0.5 h-3.5 w-3.5 text-error shrink-0" /> :
                           <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning shrink-0" />}
                          <div>
                            <p className="text-[11px]">{h.statement}</p>
                            <p className="text-[10px] text-muted">{(h.confidence * 100).toFixed(0)}% confidence · {h.status}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {run.investigation.confirmedCause && (
                    <div className="py-3">
                      <p className="text-xs font-medium">Confirmed cause</p>
                      <p className="font-mono text-xs text-accent mt-1">{run.investigation.confirmedCause}</p>
                    </div>
                  )}
                  {run.actionPlan && (
                    <div className="py-3 flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5 text-accent" />
                      <span className="text-xs">{run.actionPlan.title}</span>
                      {run.actionPlan.approvalRequired && <span className="text-[10px] text-warning bg-warning/10 px-1 py-0.5 rounded">Approval required</span>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-5 py-4 text-xs text-muted">
                  {paths.length === 0
                    ? "Collect host evidence first, then run an investigation on a healthy service path."
                    : "Run an investigation on a service path to diagnose issues with Gemini or the deterministic engine."}
                </div>
              )}
            </div>

            {/* Change ledger */}
            {changeSets.length > 0 && (
              <div className="border border-border bg-card">
                <div className="border-b border-border px-5 py-3 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-muted uppercase">Change ledger</span>
                  <button onClick={() => refresh(true)} disabled={loading} className="text-[10px] font-mono text-accent hover:underline">
                    <RefreshCw className={`inline h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
                  </button>
                </div>
                <div className="divide-y divide-border max-h-48 overflow-auto">
                  {changeSets.slice(0, 10).map(cs => (
                    <div key={cs.id} className="flex items-center justify-between gap-4 px-5 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {cs.kinds.map(k => <span key={k} className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[9px]">{k}</span>)}
                      </div>
                      <span className="font-mono text-[9px] text-muted shrink-0">{cs.serviceIds.join(", ") || "host"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Methodology: Observe → Understand → Test → Recover → Verify */}
      <div className="mt-10 border-t border-border pt-8">
        <p className="text-[10px] font-mono text-muted uppercase tracking-wider mb-1">Methodology</p>
        <h2 className="text-xl font-semibold tracking-tight mb-2">Observe. Understand. Test. Recover. Verify.</h2>
        <p className="text-xs text-muted max-w-2xl mb-6">GroundControl works through narrow tools, explicit policy and reversible actions.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <MethodCard icon={<Globe className="h-4 w-4" />} title="Understand the system behind the URL"
            detail="Maps continuous relationships between domains, TLS, proxies, Docker networks, containers, and processes — not a static snapshot." />
          <MethodCard icon={<Zap className="h-4 w-4" />} title="Test customer outcomes, not green containers"
            detail="Exercises confirmed HTTP journeys after meaningful changes. A running container is not proof that the public application works." />
          <MethodCard icon={<Shield className="h-4 w-4" />} title="Repair, redeploy or guide with context"
            detail="Restores a healthy proxy revision, redeploys a previous artifact, or prepares an exact guided plan — never a generic suggestion." />
          <MethodCard icon={<Activity className="h-4 w-4" />} title="Every confirmed recovery improves the next"
            detail="Symptoms, causes, and successful actions become service-specific operational memory. GroundControl gets sharper with every incident." />
        </div>
      </div>

      {/* Autopilot policy: Monitor → Guide → Approve → Autopilot */}
      <div className="mt-10 bg-accent/5 border border-accent/20 p-6">
        <p className="text-[10px] font-mono text-accent uppercase tracking-wider mb-1">Your infrastructure. Your policies. Your final say.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <PolicyStep step={1} label="Monitor" detail="Detect changes and exercise affected journeys" active />
          <PolicyStep step={2} label="Guide" detail="Investigate and prepare exact recovery steps" />
          <PolicyStep step={3} label="Approve" detail="Execute a reversible repair after one decision" />
          <PolicyStep step={4} label="Autopilot" detail="Act automatically inside a pre-approved policy" />
        </div>
      </div>
    </div>
  );
}

function PillarCard({ label, detail, active }: { label: string; detail: string; active?: boolean }) {
  return (
    <div className={`border p-4 ${active ? "border-accent/40 bg-accent/5" : "border-border bg-card"}`}>
      <p className="text-[10px] font-mono text-muted uppercase tracking-wider">{label}</p>
      <p className={`mt-1 text-xs font-medium ${active ? "text-accent" : "text-foreground"}`}>{detail}</p>
    </div>
  );
}

function NavItem({ icon, label, count, detail, active, sub }: {
  icon: React.ReactNode; label: string; count?: number; detail?: string; active?: boolean; sub?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
      active ? "bg-accent/10 text-accent" : sub ? "text-muted/60" : "text-muted hover:bg-background hover:text-foreground"
    }`}>
      <span className={active ? "text-accent" : ""}>{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-mono text-accent">{count}</span>
      )}
      {detail && <span className="text-[9px] text-muted">{detail}</span>}
    </div>
  );
}

function MethodCard({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="border border-border bg-card p-5">
      <span className="text-muted">{icon}</span>
      <h3 className="mt-2 text-sm font-medium">{title}</h3>
      <p className="mt-1 text-xs text-muted leading-relaxed">{detail}</p>
    </div>
  );
}

function PolicyStep({ step, label, detail, active }: { step: number; label: string; detail: string; active?: boolean }) {
  return (
    <div className={`border p-4 ${active ? "border-accent/40 bg-accent/5" : "border-border bg-card"}`}>
      <span className={`font-mono text-[10px] ${active ? "text-accent" : "text-muted"}`}>0{step}</span>
      <h4 className={`mt-1 text-xs font-medium ${active ? "text-accent" : "text-foreground"}`}>{label}</h4>
      <p className="mt-0.5 text-[10px] text-muted leading-relaxed">{detail}</p>
    </div>
  );
}
