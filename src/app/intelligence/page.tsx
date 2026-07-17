"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Play,
  RefreshCw,
  Search,
  Shield,
  Undo2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

type ServicePath = {
  domain: string;
  upstream?: string;
  containerName?: string;
  containerState?: string;
  healthy: boolean;
  issues: string[];
  serviceId?: string;
};
type Hypothesis = {
  id: string; statement: string; confidence: number; status: string; concept?: string;
};
type LoopRun = {
  id: string; state: string; isFixture?: boolean; serviceIds: string[];
  investigation?: { symptom: string; customerImpact: string; confirmedCause?: string; hypotheses: Hypothesis[]; provider: string };
  actionPlan?: { kind: string; title: string; description: string; risk: string; approvalRequired: boolean };
  verification?: Array<{ journeyId: string; ok: boolean }>;
  auditLog: Array<{ at: string; action: string }>;
};
type ReadinessCheck = { id: string; label: string; ready: boolean; detail: string };

export default function IntelligencePage() {
  const [paths, setPaths] = useState<ServicePath[]>([]);
  const [changeSets, setChangeSets] = useState<Array<{ id: string; kinds: string[]; serviceIds: string[]; eventIds: string[] }>>([]);
  const [events, setEvents] = useState<Array<{ id: string; kind: string; observedAt: string }>>([]);
  const [run, setRun] = useState<LoopRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessCheck[]>([]);
  const [activityMessage, setActivityMessage] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const refreshGraph = useCallback(async (reconcile = false) => {
    if (reconcile) {
      setLoading(true);
      setActivityMessage("Collecting containers, Compose projects and proxy routes from the active host…");
    }
    try {
      const g = await fetch("/api/intelligence/graph", reconcile ? { method: "POST" } : undefined).then((r) => r.json());
      const c = await fetch("/api/intelligence/changes").then((r) => r.json());
      if (g.error) throw new Error(g.error);
      setPaths(g.paths || []);
      setChangeSets(c.changeSets || []);
      setEvents(c.events || []);
      setError(null);
      if (reconcile) setActivityMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load intelligence data");
    } finally {
      setLoading(false);
    }
  }, []);

  const checkReadiness = useCallback(async () => {
    try {
      const res = await fetch("/api/intelligence/graph").then((r) => r.json());
      const checks: ReadinessCheck[] = [
        { id: "host", label: "Live host evidence", ready: Boolean(res.paths?.length), detail: res.paths?.length ? `${res.paths.length} service paths mapped` : "Collect Docker and proxy state from the active host." },
        { id: "path", label: "Enrolled public service", ready: Boolean(res.paths?.some((p: ServicePath) => p.domain && p.containerName)), detail: "Needs a Caddy/Nginx route reaching an enrolled deployment." },
        { id: "journey", label: "Customer journey confirmed", ready: Boolean(res.paths?.some((p: ServicePath) => p.healthy)), detail: "At least one healthy public path found." },
      ];
      setReadiness(checks);
      if (res.paths?.length === 0) setShowSetup(true);
    } catch {}
  }, []);

  useEffect(() => { refreshGraph(); checkReadiness(); }, [refreshGraph, checkReadiness]);

  const collectEvidence = () => refreshGraph(true);

  async function startInvestigation() {
    setLoading(true);
    try {
      const res = await fetch("/api/loop/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRun(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Investigation failed");
    } finally {
      setLoading(false);
    }
  }

  const healthyCount = paths.filter((p) => p.healthy).length;
  const degradedCount = paths.filter((p) => !p.healthy).length;
  const providerReady = true; // deterministic fixtures work without Gemini

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <PageHeader
        title="Intelligence"
        description="GroundControl continuously understands your services, detects meaningful changes, and maps the path from domain to container — so you know what's running and what changed."
      />

      {/* Live status strip */}
      {paths.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <StatCard label="Service paths" value={paths.length} detail={`${healthyCount} healthy · ${degradedCount} need attention`} tone={degradedCount > 0 ? "warning" : "success"} />
          <StatCard label="Change sets" value={changeSets.length} detail={changeSets.length > 0 ? `${changeSets[changeSets.length - 1]?.kinds.join(", ")}` : "No changes detected"} tone="muted" />
          <StatCard label="Investigations" value={run ? 1 : 0} detail={run ? `State: ${run.state}` : "Run your first investigation"} tone={run ? "accent" : "muted"} />
        </div>
      )}

      {activityMessage && <div className="mt-4 border-l-2 border-accent bg-card px-3 py-2 text-xs text-muted">{activityMessage}</div>}
      {error && <div className="mt-4 rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">{error}</div>}

      {/* Empty state — shown only when no data */}
      {paths.length === 0 && !loading && (
        <div className="mt-8 flex flex-col items-center gap-4 rounded-lg border border-dashed border-border p-12 text-center">
          <Search className="h-10 w-10 text-muted/50" />
          <div>
            <h2 className="text-lg font-medium">No intelligence data yet</h2>
            <p className="mt-1 max-w-md text-sm text-muted">
              GroundControl needs to read your host to map services, domains, and containers. This is read-only — nothing is changed on your VPS.
            </p>
          </div>
          <button type="button" onClick={collectEvidence} disabled={loading} className="gc-button gc-button-primary">
            <Activity className="h-4 w-4" />
            {loading ? "Collecting…" : "Collect host evidence"}
          </button>
        </div>
      )}

      {/* Service graph — the main event */}
      {paths.length > 0 && (
        <section className="mt-6 border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Service paths</h2>
              <p className="mt-1 text-xs text-muted">Domain → proxy → container — the path your customers take to reach each service.</p>
            </div>
            <button type="button" onClick={collectEvidence} disabled={loading} className="gc-button gc-button-secondary text-xs">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
          <div className="divide-y divide-border">
            {paths.map((p) => (
              <div key={p.domain} className="group px-5 py-4 transition-colors hover:bg-background/50">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium truncate">{p.domain}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono ${
                        p.healthy ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                      }`}>{p.healthy ? "healthy" : "degraded"}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <span className="font-mono">{p.domain}</span>
                      <span className="text-muted/40">→</span>
                      <span className="font-mono">{p.upstream || "proxy"}</span>
                      <span className="text-muted/40">→</span>
                      <span className="font-mono">{p.containerName || "?"} ({p.containerState || "unknown"})</span>
                    </div>
                    {p.issues.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.issues.map((i) => (
                          <span key={i} className="rounded bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">{i}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setSelectedPath(selectedPath === p.domain ? null : p.domain)}
                    className="shrink-0 rounded p-1.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background hover:text-foreground">
                    <Search className="h-3.5 w-3.5" />
                  </button>
                </div>
                {selectedPath === p.domain && (
                  <div className="mt-3 rounded border border-border bg-background p-3">
                    <p className="text-[10px] text-muted">This path was observed from live host evidence. GroundControl compares it with the last known healthy state to detect regressions.</p>
                    <div className="mt-2 flex gap-2">
                      <button onClick={startInvestigation} disabled={loading} className="gc-button gc-button-secondary text-[11px]">
                        <Play className="h-3 w-3" /> Investigate this path
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Changes */}
      {changeSets.length > 0 && (
        <section className="mt-6 border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold">Recent changes</h2>
            <p className="mt-1 text-xs text-muted">Host changes that could affect your services.</p>
          </div>
          <div className="divide-y divide-border">
            {changeSets.slice(0, 10).map((cs) => (
              <div key={cs.id} className="grid gap-2 px-5 py-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap gap-1">
                    {cs.kinds.map((k) => <span key={k} className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">{k}</span>)}
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-muted">{cs.id} · {cs.eventIds.length} events</p>
                </div>
                <span className="font-mono text-[10px] text-muted">{cs.serviceIds.join(", ") || "host-wide"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Loop investigation */}
      {run && (
        <section className="mt-6 border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold">Investigation</h2>
            <p className="mt-1 text-xs text-muted">
              {run.state === "investigating" ? "Loop is collecting evidence and forming hypotheses." :
               run.state === "planning" ? "Recovery plan prepared — awaiting approval." :
               run.state === "recovered" ? "Recovery verified — service is healthy." :
               `Current state: ${run.state}`}
            </p>
          </div>
          {run.investigation && (
            <div className="divide-y divide-border px-5 py-4">
              <div className="pb-3">
                <p className="text-xs font-medium">Symptom</p>
                <p className="mt-1 text-xs text-muted">{run.investigation.symptom}</p>
                <p className="mt-1 text-xs text-muted">Customer impact: {run.investigation.customerImpact}</p>
              </div>
              {run.investigation.hypotheses.length > 0 && (
                <div className="py-3">
                  <p className="text-xs font-medium">Hypotheses</p>
                  {run.investigation.hypotheses.map((h) => (
                    <div key={h.id} className="mt-2 flex items-start gap-2">
                      {h.status === "confirmed" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success shrink-0" /> :
                       h.status === "rejected" ? <XCircle className="mt-0.5 h-3.5 w-3.5 text-error shrink-0" /> :
                       <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning shrink-0" />}
                      <div>
                        <p className="text-xs">{h.statement}</p>
                        <p className="text-[10px] text-muted">Confidence: {(h.confidence * 100).toFixed(0)}% · {h.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {run.investigation.confirmedCause && (
                <div className="pt-3">
                  <p className="text-xs font-medium">Confirmed cause</p>
                  <p className="mt-1 text-xs text-accent font-mono">{run.investigation.confirmedCause}</p>
                </div>
              )}
              <p className="pt-3 text-[10px] text-muted">Provider: {run.investigation.provider}</p>
            </div>
          )}
          {run.actionPlan && (
            <div className="border-t border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-accent" />
                <span className="text-xs font-medium">{run.actionPlan.title}</span>
                {run.actionPlan.approvalRequired && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">Approval required</span>}
              </div>
              <p className="mt-2 text-xs text-muted">{run.actionPlan.description}</p>
              <p className="mt-1 text-[10px] text-muted">Risk: {run.actionPlan.risk} · Kind: {run.actionPlan.kind}</p>
            </div>
          )}
          {run.auditLog.length > 0 && (
            <div className="border-t border-border px-5 py-3">
              <p className="text-[10px] font-medium text-muted mb-1">Activity</p>
              {run.auditLog.slice(-8).map((entry, i) => (
                <p key={i} className="font-mono text-[10px] text-muted">{entry.at} · {entry.action}</p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Setup guide — collapsible, not the hero */}
      {readiness.length > 0 && (
        <details className="mt-6 border border-border bg-card/60" open={showSetup}>
          <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-muted hover:text-foreground" onClick={() => setShowSetup(!showSetup)}>
            {readiness.filter((r) => r.ready).length}/{readiness.length} readiness checks passed
          </summary>
          <div className="divide-y divide-border border-t border-border">
            {readiness.map((check) => (
              <div key={check.id} className="flex gap-3 px-5 py-3">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${check.ready ? "bg-success" : "bg-warning"}`} />
                <div>
                  <div className="text-xs font-medium">{check.label}</div>
                  <div className="mt-0.5 text-[11px] text-muted">{check.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-5 py-3 flex gap-2">
            <button onClick={collectEvidence} disabled={loading} className="gc-button gc-button-secondary text-[11px]">
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Collect evidence
            </button>
            {changeSets.length > 0 && (
              <button onClick={startInvestigation} disabled={loading} className="gc-button gc-button-primary text-[11px]">
                <Play className="h-3 w-3" /> Run investigation
              </button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function StatCard({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: "success" | "warning" | "muted" | "accent" }) {
  return (
    <div className="border border-border bg-card p-4">
      <p className="text-[10px] font-mono text-muted uppercase tracking-wider">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${
        tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "accent" ? "text-accent" : "text-foreground"
      }`}>{value}</p>
      <p className="mt-0.5 text-[10px] text-muted">{detail}</p>
    </div>
  );
}
