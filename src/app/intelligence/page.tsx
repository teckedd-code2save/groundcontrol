"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, RefreshCw, Shield, XCircle, Zap } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, Notice } from "@/components/ui";

type ServicePath = { domain: string; upstream?: string; containerName?: string; containerState?: string; healthy: boolean; issues: string[]; serviceId?: string };
type EvidenceStep = { id: string; label: string; status: "ok" | "warning" | "unknown"; detail: string };
type ChangeSet = { id: string; kinds: string[]; serviceIds: string[] };
type GraphMeta = { hostId: string; source: string; reconciledAt: string; nodeCount: number; edgeCount: number; newEvents?: number };

export default function IntelligencePage() {
  const [paths, setPaths] = useState<ServicePath[]>([]);
  const [changeSets, setChangeSets] = useState<ChangeSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<ServicePath | null>(null);
  const [run, setRun] = useState<any>(null);
  const [graphMeta, setGraphMeta] = useState<GraphMeta | null>(null);

  const refresh = useCallback(async (reconcile = false) => {
    setLoading(true);
    try {
      const [g, c] = await Promise.all([
        fetch("/api/intelligence/graph", reconcile ? { method: "POST" } : undefined).then(r => r.json()),
        fetch("/api/intelligence/changes").then(r => r.json()),
      ]);
      if (g.error) throw new Error(g.error);
      const nextPaths: ServicePath[] = Array.isArray(g.paths) ? g.paths : [];
      setPaths(nextPaths);
      setSelectedPath((current) => current ? nextPaths.find((path) => path.domain === current.domain) || null : null);
      setGraphMeta({
        hostId: String(g.hostId || ""),
        source: String(g.source || "unknown"),
        reconciledAt: String(g.reconciledAt || ""),
        nodeCount: Number(g.nodeCount || 0),
        edgeCount: Number(g.edgeCount || 0),
        newEvents: typeof g.newEvents === "number" ? g.newEvents : undefined,
      });
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

  const selectedEvidence: EvidenceStep[] = selectedPath ? [
    { id: "dns", label: "DNS resolution", status: "unknown", detail: "Not independently probed during topology reconciliation" },
    { id: "tls", label: "TLS certificate", status: "unknown", detail: "Not independently probed during topology reconciliation" },
    { id: "proxy", label: `Proxy route ${selectedPath.upstream || "unknown"}`, status: selectedPath.upstream ? "ok" : "warning", detail: selectedPath.upstream ? `Observed route targets ${selectedPath.upstream}` : "No proxy upstream was resolved" },
    { id: "container", label: `Container ${selectedPath.containerName || "unknown"}`, status: selectedPath.healthy ? "ok" : "warning", detail: selectedPath.containerState ? `Observed state: ${selectedPath.containerState}` : "No matching container was found" },
  ] : [];

  const healthyCount = paths.filter(p => p.healthy).length;

  return (
    <div className="gc-page gc-page--wide">
      <PageHeader
        eyebrow="Operational intelligence"
        title="Intelligence"
        description="Live service relationships, customer-facing journeys, evidence-backed diagnosis, and reversible recovery."
      />

      {error && <Notice className="mt-4" tone="danger">{error}</Notice>}

      <div className="mt-6 grid grid-cols-2 overflow-hidden border border-border bg-card lg:grid-cols-4">
        <IntelligenceStat label="Service paths" value={String(paths.length)} detail="Mapped from public routes" />
        <IntelligenceStat label="Verified healthy" value={`${healthyCount}/${paths.length}`} detail="Current host evidence" tone={paths.length > 0 && healthyCount === paths.length ? "success" : "warning"} />
        <IntelligenceStat label="Change sets" value={String(changeSets.length)} detail="Evidence awaiting correlation" />
        <IntelligenceStat label="Autonomy" value="Monitor" detail="Read-only until policy allows" />
      </div>

      {/* Empty state */}
      {paths.length === 0 && !loading && (
        <EmptyState
          className="mt-8"
          icon={<Activity size={22} />}
          title="No service graph yet"
          description="GroundControl reads your host to map every service from domain to container. This is read-only—nothing on your VPS changes."
          action={
            <Button
              variant="primary"
              onClick={() => refresh(true)}
              disabled={loading}
              leadingIcon={<RefreshCw className={loading ? "animate-spin" : ""} size={14} />}
            >
              {loading ? "Collecting host evidence…" : "Collect host evidence"}
            </Button>
          }
        />
      )}

      {paths.length > 0 && (
        <div className="min-w-0 space-y-6">
            <div className="flex flex-col gap-3 border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono text-muted">SERVICE GRAPH</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  <span className="text-[10px] font-mono text-success uppercase">{healthyCount}/{paths.length} healthy</span>
                </div>
                <h2 className="text-sm font-semibold">Live host topology</h2>
                <p className="mt-1 font-mono text-[9px] text-text-dim">
                  {graphMeta?.source || "unknown"} · {graphMeta?.hostId || "host unavailable"} · {formatObservationTime(graphMeta?.reconciledAt)}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => refresh(true)}
                disabled={loading}
                leadingIcon={<RefreshCw size={13} className={loading ? "animate-spin" : ""} />}
              >
                {loading ? "Scanning…" : "Scan host"}
              </Button>
            </div>

            <div className="border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="gc-eyebrow">Observed public paths</span>
                <span className="font-mono text-[9px] text-muted">{paths.length} total · none hidden</span>
              </div>
              <div className="max-h-[460px] divide-y divide-border overflow-y-auto">
                {paths.map((path) => (
                  <button
                    key={path.domain}
                    type="button"
                    onClick={() => setSelectedPath(selectedPath?.domain === path.domain ? null : path)}
                    className={`grid w-full gap-3 px-4 py-3 text-left transition-colors sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center ${
                      selectedPath?.domain === path.domain ? "bg-accent/[0.07]" : "hover:bg-white/[0.025]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-[9px] uppercase text-muted">Public endpoint</span>
                      <span className="mt-0.5 block truncate text-xs font-medium">{path.domain}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-2 font-mono text-[10px] text-muted">
                      <span className="truncate">{path.upstream || "unresolved route"}</span>
                      <ArrowRight size={12} className="shrink-0 text-text-dim" />
                      <span className="truncate">{path.containerName || "no container"}</span>
                    </span>
                    <span className={`font-mono text-[9px] uppercase ${path.healthy ? "text-success" : "text-error"}`}>
                      {path.healthy ? "healthy" : "attention"}
                    </span>
                  </button>
                ))}
              </div>
              {selectedPath && (
                <div className="space-y-3 border-t border-border bg-background/30 p-4">
                  {!selectedPath.healthy && (
                    <Notice tone="danger">{selectedPath.issues.join(", ") || "Service degraded"}</Notice>
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
                      {step.status === "ok" ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success shrink-0" />
                      ) : step.status === "warning" ? (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 text-error shrink-0" />
                      ) : (
                        <CircleHelp className="mt-0.5 h-3.5 w-3.5 text-muted shrink-0" />
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
      )}

      <details className="mt-8 border border-border bg-card">
        <summary className="cursor-pointer px-5 py-4 text-xs font-medium">Intelligence method and autonomy policy</summary>
        <div className="border-t border-border p-5">
          <p className="max-w-2xl text-xs leading-relaxed text-muted">GroundControl observes the live relationship behind a public URL, tests confirmed customer outcomes, explains evidence before action, and keeps recovery reversible.</p>
          <div className="mt-5 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-4">
            <PolicyStep step={1} label="Monitor" detail="Detect and verify" active />
            <PolicyStep step={2} label="Guide" detail="Prepare exact steps" />
            <PolicyStep step={3} label="Approve" detail="Execute after approval" />
            <PolicyStep step={4} label="Autopilot" detail="Allowlisted low-risk action" />
          </div>
        </div>
      </details>
    </div>
  );
}

function IntelligenceStat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "success" | "warning" }) {
  return (
    <div className="border-b border-r border-border p-4 last:border-r-0 lg:border-b-0">
      <p className="gc-eyebrow">{label}</p>
      <p className={`mt-2 text-xl font-medium tracking-[-0.035em] ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground"}`}>{value}</p>
      <p className="mt-1 text-[10px] text-muted">{detail}</p>
    </div>
  );
}

function PolicyStep({ step, label, detail, active }: { step: number; label: string; detail: string; active?: boolean }) {
  return (
    <div className={`bg-card p-4 ${active ? "text-accent" : ""}`}>
      <span className={`font-mono text-[10px] ${active ? "text-accent" : "text-muted"}`}>0{step}</span>
      <h4 className={`mt-1 text-xs font-medium ${active ? "text-accent" : "text-foreground"}`}>{label}</h4>
      <p className="mt-0.5 text-[10px] text-muted leading-relaxed">{detail}</p>
    </div>
  );
}

function formatObservationTime(value?: string) {
  if (!value) return "not reconciled yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return `observed ${date.toLocaleString()}`;
}
