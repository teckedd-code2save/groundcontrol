"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Loader2,
  Play,
  Shield,
  Undo2,
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
  id: string;
  statement: string;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  confidence: number;
  status: string;
  concept?: string;
};

type LoopRun = {
  id: string;
  state: string;
  isFixture?: boolean;
  serviceIds: string[];
  journeyResults: Array<{ journeyId: string; ok: boolean }>;
  investigation?: {
    symptom: string;
    customerImpact: string;
    confirmedConcept?: string;
    confirmedCause?: string;
    uncertainty: string[];
    hypotheses: Hypothesis[];
    evidence: Array<{ id: string; kind: string; summary: string }>;
    provider: string;
  };
  actionPlan?: {
    id: string;
    kind: string;
    title: string;
    description: string;
    risk: string;
    approvalRequired: boolean;
    expectedResult: string;
    params: Record<string, unknown>;
  };
  verification?: Array<{ journeyId: string; ok: boolean }>;
  sideEffects: Record<string, boolean>;
  auditLog: Array<{ at: string; action: string; detail?: string }>;
  approvedBy?: string;
};

export default function IntelligencePage() {
  const [paths, setPaths] = useState<ServicePath[]>([]);
  const [changeSets, setChangeSets] = useState<
    Array<{ id: string; kinds: string[]; serviceIds: string[]; eventIds: string[] }>
  >([]);
  const [events, setEvents] = useState<
    Array<{ id: string; kind: string; observedAt: string; serviceIds: string[] }>
  >([]);
  const [run, setRun] = useState<LoopRun | null>(null);
  const [maturity, setMaturity] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixtureNote, setFixtureNote] = useState<string | null>(null);
  const [graphSource, setGraphSource] = useState<string>("");

  const refreshGraph = useCallback(async () => {
    const [g, c] = await Promise.all([
      fetch("/api/intelligence/graph").then((r) => r.json()),
      fetch("/api/intelligence/changes").then((r) => r.json()),
    ]);
    if (g.error) throw new Error(g.error);
    setPaths(g.paths || []);
    setGraphSource(g.source || g.maturity || "");
    setMaturity(g.maturity || "");
    setChangeSets(c.changeSets || []);
    setEvents(c.events || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [g, c] = await Promise.all([
          fetch("/api/intelligence/graph").then((r) => r.json()),
          fetch("/api/intelligence/changes").then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (g.error) {
          setError(g.error);
          return;
        }
        setPaths(g.paths || []);
        setGraphSource(g.source || g.maturity || "");
        setMaturity(g.maturity || "");
        setChangeSets(c.changeSets || []);
        setEvents(c.events || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadFixture() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/fixtures/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixture: "wrong_upstream" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load fixture");
      setFixtureNote(
        `${data.label} (${data.fixture}) — product fixture, not live host data.`
      );
      setRun(null);
      await refreshGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function startInvestigation() {
    setLoading(true);
    setError(null);
    try {
      const changeSetId = changeSets[0]?.id;
      const res = await fetch("/api/loop/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeSetId,
          domain: paths[0]?.domain || "app.example.com",
          probeStatus: 502,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start Loop run");
      setRun(data.run);
      setMaturity(data.maturity || "fixture");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function approveRecovery() {
    if (!run) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/loop/runs/${run.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probeStatus: 200 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approve failed");
      setRun(data.run);
      setMaturity(data.maturity || maturity);
      await refreshGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const stateLabel = run?.state?.replace(/_/g, " ") || "idle";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <PageHeader
        title="Intelligence"
        description="Loop maps host changes, runs confirmed customer journeys, investigates with evidence, and prepares approved reversible recovery. Autopilot is not enabled."
      />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs">
        <Shield className="h-3.5 w-3.5 text-muted" />
        <span className="font-mono text-muted">Maturity:</span>
        <span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono">
          {maturity || graphSource || "empty"}
        </span>
        <span className="text-muted">
          M1–M5: graph · journeys · recovery · Daytona · guarded autopilot. Live Caddy when{" "}
          <span className="font-mono">GC_LOOP_LIVE=1</span>. Gemini when{" "}
          <span className="font-mono">GEMINI_API_KEY</span> set.
        </span>
        {fixtureNote && (
          <span className="text-amber-700 dark:text-amber-400">{fixtureNote}</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={loadFixture}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted/40 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
          Load 502 fixture
        </button>
        <button
          type="button"
          onClick={startInvestigation}
          disabled={loading || changeSets.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" />
          Run investigation
        </button>
        <button
          type="button"
          onClick={approveRecovery}
          disabled={loading || run?.state !== "awaiting_approval"}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-600/10 px-3 py-1.5 text-sm text-emerald-800 dark:text-emerald-300 disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approve recovery
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Service paths */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4" />
            Service paths
          </h2>
          {paths.length === 0 ? (
            <p className="text-sm text-muted">
              No graph loaded. Load the fixture to see domain → proxy → container paths.
            </p>
          ) : (
            <ul className="space-y-2">
              {paths.map((p) => (
                <li
                  key={p.domain}
                  className="rounded-md border border-border/80 bg-background/50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium">{p.domain}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-mono uppercase ${
                        p.healthy
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-orange-500/15 text-orange-700 dark:text-orange-300"
                      }`}
                    >
                      {p.healthy ? "healthy" : "degraded"}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted">
                    {p.upstream || "?"} → {p.containerName || "no container"} (
                    {p.containerState || "?"})
                  </div>
                  {p.issues.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.issues.map((i) => (
                        <span
                          key={i}
                          className="rounded bg-orange-500/10 px-1 font-mono text-[10px] text-orange-800 dark:text-orange-300"
                        >
                          {i}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Change ledger */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="h-4 w-4" />
            Change ledger
          </h2>
          {changeSets.length === 0 ? (
            <p className="text-sm text-muted">No change sets yet.</p>
          ) : (
            <ul className="space-y-2">
              {changeSets.map((cs) => (
                <li
                  key={cs.id}
                  className="rounded-md border border-border/80 bg-background/50 px-3 py-2 text-sm"
                >
                  <div className="font-mono text-xs text-muted">{cs.id}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {cs.kinds.map((k) => (
                      <span
                        key={k}
                        className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    services: {cs.serviceIds.join(", ") || "—"} · events:{" "}
                    {cs.eventIds.length}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {events.length > 0 && (
            <div className="mt-3 max-h-32 overflow-auto border-t border-border pt-2">
              {events.map((ev) => (
                <div key={ev.id} className="font-mono text-[10px] text-muted">
                  {ev.observedAt} · {ev.kind} · {ev.serviceIds.join(",")}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Loop run */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4" />
          Loop run
          {run && (
            <span className="ml-2 rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-normal uppercase">
              {stateLabel}
            </span>
          )}
        </h2>

        {!run ? (
          <p className="text-sm text-muted">
            Load a fixture, then run investigation to create a Loop run.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border/80 bg-background/40 p-3">
                <div className="text-[10px] font-mono uppercase text-muted">
                  Customer impact
                </div>
                <p className="mt-1 text-sm">
                  {run.investigation?.customerImpact || "—"}
                </p>
                <div className="mt-2 text-[10px] font-mono uppercase text-muted">
                  Symptom
                </div>
                <p className="mt-1 text-sm">{run.investigation?.symptom || "—"}</p>
              </div>
              <div className="rounded-md border border-border/80 bg-background/40 p-3">
                <div className="text-[10px] font-mono uppercase text-muted">
                  Confirmed concept
                </div>
                <p className="mt-1 font-mono text-sm">
                  {run.investigation?.confirmedConcept || "—"}
                </p>
                <div className="mt-2 text-[10px] font-mono uppercase text-muted">
                  Uncertainty
                </div>
                <ul className="mt-1 list-inside list-disc text-xs text-muted">
                  {(run.investigation?.uncertainty || []).length === 0 && (
                    <li>None recorded (high-confidence path)</li>
                  )}
                  {(run.investigation?.uncertainty || []).map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Hypotheses */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Hypotheses
              </h3>
              <ul className="space-y-2">
                {(run.investigation?.hypotheses || []).map((h) => (
                  <li
                    key={h.id}
                    className="rounded-md border border-border/70 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                          h.status === "confirmed"
                            ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                            : h.status === "rejected"
                              ? "bg-muted text-muted-foreground"
                              : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                        }`}
                      >
                        {h.status}
                      </span>
                      {h.concept && (
                        <span className="font-mono text-[10px] text-muted">
                          {h.concept}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-muted">
                        conf {(h.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="mt-1">{h.statement}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      evidence: {h.supportingEvidenceIds.join(", ") || "—"}
                      {h.contradictingEvidenceIds.length > 0 &&
                        ` · contradicts: ${h.contradictingEvidenceIds.join(", ")}`}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            {/* Action plan */}
            {run.actionPlan && (
              <div className="rounded-md border border-emerald-600/25 bg-emerald-600/5 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Proposed recovery
                </h3>
                <p className="mt-1 text-sm font-medium">{run.actionPlan.title}</p>
                <p className="mt-1 text-sm text-muted">{run.actionPlan.description}</p>
                <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px]">
                  <span className="rounded bg-background px-1.5 py-0.5">
                    {run.actionPlan.kind}
                  </span>
                  <span className="rounded bg-background px-1.5 py-0.5">
                    risk:{run.actionPlan.risk}
                  </span>
                  <span className="rounded bg-background px-1.5 py-0.5">
                    approval:{run.actionPlan.approvalRequired ? "required" : "no"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Expected: {run.actionPlan.expectedResult}
                </p>
              </div>
            )}

            {/* Verification */}
            {run.verification && run.verification.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm">
                {run.verification.every((v) => v.ok) ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                ) : (
                  <Undo2 className="mt-0.5 h-4 w-4 text-orange-600" />
                )}
                <div>
                  <div className="font-medium">Verification</div>
                  {run.verification.map((v) => (
                    <div key={v.journeyId} className="font-mono text-xs text-muted">
                      {v.journeyId}: {v.ok ? "passed" : "failed"}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-28 overflow-auto rounded border border-border/60 bg-background/30 p-2">
              <div className="mb-1 text-[10px] font-mono uppercase text-muted">
                Audit
              </div>
              {run.auditLog.map((a, i) => (
                <div key={`${a.at}-${i}`} className="font-mono text-[10px] text-muted">
                  {a.at} · {a.action}
                  {a.detail ? ` · ${a.detail}` : ""}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
