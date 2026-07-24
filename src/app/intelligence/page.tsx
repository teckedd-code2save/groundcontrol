"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Fingerprint,
  Network,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Wrench,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, Notice, StatusBadge } from "@/components/ui";

type Verification = {
  status: "passed" | "responded" | "failed" | "not_run";
  statusCode?: number;
  latencyMs?: number;
  error?: string;
  observedAt?: string;
  target?: string;
};

type PathInspection = {
  domain: string;
  observedAt: string;
  outcome: "healthy" | "degraded" | "failed";
  failureBoundary?: "edge" | "proxy_to_upstream" | "upstream" | "application";
  summary: string;
  cause?: string;
  confidence: number;
  evidence: Array<{
    id: "edge" | "proxy" | "upstream" | "runtime";
    label: string;
    value: string;
    detail: string;
    status: "verified" | "failed" | "observed";
  }>;
  nextAction?: {
    title: string;
    detail: string;
    mode: "automatic" | "approval" | "guided";
  };
  deepInvestigation?: {
    geminiEligible: boolean;
    daytonaEligible: boolean;
    reason: string;
  };
};

type ServicePath = {
  domain: string;
  upstream?: string;
  containerName?: string;
  containerState?: string;
  containerPort?: number;
  healthy: boolean;
  issues: string[];
  serviceId?: string;
  linkMethod?: "container_name" | "compose_service" | "published_port";
  topologyStatus?: "linked" | "partial";
  verification: Verification;
  inspection?: PathInspection;
};

type ChangeSet = {
  id: string;
  kinds: string[];
  serviceIds: string[];
  eventIds: string[];
  firstObservedAt: string;
  lastObservedAt: string;
};

type ReadinessItem = { id: string; label: string; ready: boolean; detail: string };

type Hypothesis = {
  id: string;
  statement: string;
  status: "open" | "confirmed" | "rejected";
  confidence: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
};

type Evidence = { id: string; kind: string; summary: string; detail?: string; observedAt: string };

type ActionPlan = {
  title: string;
  description: string;
  kind: string;
  risk: "low" | "medium" | "high" | "destructive";
  approvalRequired: boolean;
  preconditions: string[];
  expectedResult: string;
  verificationJourneyIds: string[];
  rollbackKind?: string;
};

type JourneyResult = {
  journeyId: string;
  ok: boolean;
  observedAt: string;
  stepResults: Array<{ stepIndex: number; ok: boolean; detail: string; statusCode?: number }>;
};

type LoopRun = {
  id: string;
  state: string;
  serviceIds: string[];
  createdAt: string;
  updatedAt: string;
  investigation?: {
    symptom: string;
    customerImpact: string;
    provider: string;
    hypotheses: Hypothesis[];
    confirmedCause?: string;
    uncertainty: string[];
    evidence: Evidence[];
  };
  actionPlan?: ActionPlan;
  journeyResults: JourneyResult[];
  verification?: JourneyResult[];
  auditLog: Array<{ at: string; action: string; detail?: string }>;
};

type GraphMeta = {
  hostId: string;
  source: string;
  reconciledAt: string;
  nodeCount: number;
  edgeCount: number;
  maturity: string;
  readiness: ReadinessItem[];
};

const LOOP_STAGES = [
  ["01", "Observe"],
  ["02", "Understand"],
  ["03", "Test"],
  ["04", "Diagnose"],
  ["05", "Recover"],
  ["06", "Verify"],
  ["07", "Remember"],
] as const;

export default function IntelligencePage() {
  const [paths, setPaths] = useState<ServicePath[]>([]);
  const [changeSets, setChangeSets] = useState<ChangeSet[]>([]);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [run, setRun] = useState<LoopRun | null>(null);
  const [graphMeta, setGraphMeta] = useState<GraphMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<"scan" | "investigate" | "recover" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPath = useMemo(
    () => paths.find((path) => path.domain === selectedDomain) || paths[0] || null,
    [paths, selectedDomain]
  );

  const refresh = useCallback(async (reconcile = false) => {
    setLoading(true);
    if (reconcile) setOperation("scan");
    try {
      const graphResponse = await fetch("/api/intelligence/graph", reconcile ? { method: "POST" } : undefined);
      const graph = await graphResponse.json();
      if (!graphResponse.ok || graph.error) throw new Error(graph.error || "Could not read the service graph");
      const changesResponse = await fetch("/api/intelligence/changes");
      const changes = await changesResponse.json();
      if (!changesResponse.ok || changes.error) throw new Error(changes.error || "Could not read the change ledger");

      const nextPaths = Array.isArray(graph.paths) ? graph.paths as ServicePath[] : [];
      setPaths(nextPaths);
      setSelectedDomain((current) => nextPaths.some((path) => path.domain === current) ? current : nextPaths[0]?.domain || "");
      setChangeSets(Array.isArray(changes.changeSets) ? changes.changeSets : []);
      setGraphMeta({
        hostId: String(graph.hostId || ""),
        source: String(graph.source || "unknown"),
        reconciledAt: String(graph.reconciledAt || ""),
        nodeCount: Number(graph.nodeCount || 0),
        edgeCount: Number(graph.edgeCount || 0),
        maturity: String(graph.maturity || "awaiting_observation"),
        readiness: Array.isArray(graph.readiness) ? graph.readiness : [],
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Intelligence");
    } finally {
      setLoading(false);
      setOperation(null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function runInvestigation() {
    if (!selectedPath) return;
    setLoading(true);
    setOperation("investigate");
    setError(null);
    try {
      const response = await fetch("/api/loop/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: selectedPath.domain }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Investigation failed");
      setRun(data.run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Investigation failed");
    } finally {
      setLoading(false);
      setOperation(null);
    }
  }

  async function approveRecovery() {
    if (!run) return;
    setLoading(true);
    setOperation("recover");
    setError(null);
    try {
      const response = await fetch(`/api/loop/runs/${encodeURIComponent(run.id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Recovery could not be applied");
      setRun(data.run);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recovery could not be applied");
    } finally {
      setLoading(false);
      setOperation(null);
    }
  }

  const passedCount = paths.filter((path) => path.verification?.status === "passed").length;
  const failedCount = paths.filter((path) => path.verification?.status === "failed").length;
  const linkedCount = paths.filter((path) => path.topologyStatus === "linked").length;
  const recoveryReady = graphMeta?.readiness.find((item) => item.id === "recovery")?.ready ?? false;
  const persistenceReady = graphMeta?.readiness.find((item) => item.id === "persistence")?.ready ?? false;

  return (
    <div className="gc-page gc-page--wide">
      <PageHeader
        eyebrow="Loop · operational intelligence"
        title="Investigate the system behind the URL"
        description="Observe host changes, trace the affected service path, test the public outcome, diagnose with evidence, recover by policy, verify externally, and retain the result."
        actions={(
          <Button
            variant="primary"
            onClick={() => refresh(true)}
            disabled={loading}
            leadingIcon={<RefreshCw size={14} className={operation === "scan" ? "animate-spin" : ""} />}
          >
            {operation === "scan" ? "Scanning and testing…" : "Scan host"}
          </Button>
        )}
      />

      {error && <Notice className="mt-5" tone="danger" title="Operation did not complete">{error}</Notice>}

      <div className="mt-6 border border-border bg-card">
        <div className="grid gap-px bg-border sm:grid-cols-4">
          <SummaryCell label="Observed paths" value={String(paths.length)} detail={`${linkedCount} linked to runtime`} />
          <SummaryCell label="Publicly verified" value={`${passedCount}/${paths.length}`} detail="Real external HTTP checks" tone={failedCount > 0 ? "danger" : passedCount > 0 ? "success" : "neutral"} />
          <SummaryCell label="Open failures" value={String(failedCount)} detail="Customer reachability failures" tone={failedCount > 0 ? "danger" : "neutral"} />
          <SummaryCell label="Autonomy" value="Monitor" detail="Mutation remains policy gated" />
        </div>
      </div>

      <StageRail run={run} selectedPath={selectedPath} hasGraph={paths.length > 0} />

      {paths.length === 0 && !loading ? (
        <EmptyState
          className="mt-6"
          icon={<Activity size={22} />}
          title="No live system has been identified yet"
          description="Scan the active host to read proxy routes, Docker and Compose evidence, then run a real public reachability check for every discovered domain."
          action={<Button variant="primary" onClick={() => refresh(true)} leadingIcon={<SearchCheck size={14} />}>Identify this system</Button>}
        />
      ) : paths.length > 0 ? (
        <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <div className="border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <p className="gc-eyebrow">System identity</p>
                <p className="mt-1 truncate text-sm font-semibold">{selectedPath?.serviceId || selectedPath?.domain}</p>
                <p className="mt-1 break-all font-mono text-[9px] text-text-dim">{graphMeta?.hostId || "host not identified"}</p>
              </div>
              <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
                {paths.map((path) => (
                  <button
                    key={path.domain}
                    type="button"
                    onClick={() => { setSelectedDomain(path.domain); setRun(null); setError(null); }}
                    className={`w-full px-4 py-3 text-left transition-colors ${selectedPath?.domain === path.domain ? "bg-accent/10" : "hover:bg-white/[0.025]"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-xs font-medium">{path.domain}</span>
                      <PathStatus status={path.verification?.status || "not_run"} compact />
                    </div>
                    <p className="mt-1 truncate font-mono text-[9px] text-muted">{path.upstream || "proxy target unresolved"}</p>
                  </button>
                ))}
              </div>
              <div className="border-t border-border px-4 py-3 font-mono text-[9px] text-text-dim">
                {graphMeta?.nodeCount || 0} nodes · {graphMeta?.edgeCount || 0} relationships · {formatTime(graphMeta?.reconciledAt)}
              </div>
            </div>
          </aside>

          {selectedPath && (
            <main className="min-w-0 border border-border bg-card">
              <StageSection number="01" label="Observe" icon={<Activity size={16} />} state="complete" summary="Host and change evidence collected">
                <div className="grid gap-px border border-border bg-border sm:grid-cols-3">
                  <Fact label="Observation source" value={graphMeta?.source || "unknown"} />
                  <Fact label="Last reconciliation" value={formatTime(graphMeta?.reconciledAt)} />
                  <Fact label="Relevant change sets" value={String(changeSets.length)} />
                </div>
                {changeSets.length > 0 ? (
                  <div className="mt-4 divide-y divide-border border border-border">
                    {changeSets.slice(0, 4).map((change) => (
                      <div key={change.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-center">
                        <span className="font-mono text-[9px] text-text-dim">{change.id}</span>
                        <span className="flex flex-wrap gap-1.5">{change.kinds.map((kind) => <StatusBadge key={kind} dot={false}>{humanize(kind)}</StatusBadge>)}</span>
                        <span className="font-mono text-[9px] text-muted">{formatTime(change.lastObservedAt)}</span>
                      </div>
                    ))}
                  </div>
                ) : <Notice className="mt-4">No meaningful change is recorded yet. The scan still establishes current system identity and reachability.</Notice>}
              </StageSection>

              <StageSection number="02" label="Understand" icon={<Network size={16} />} state={selectedPath.inspection?.outcome === "failed" ? "attention" : "complete"} summary="Isolate the first broken boundary with verified evidence">
                <RelationshipChain path={selectedPath} />
                {selectedPath.inspection?.failureBoundary && (
                  <div className="mt-4 border border-error/35 bg-error/[0.045] p-4">
                    <p className="gc-eyebrow text-error">Failure boundary · {humanize(selectedPath.inspection.failureBoundary)}</p>
                    <p className="mt-2 text-sm font-semibold">{selectedPath.inspection.summary}</p>
                    {selectedPath.inspection.cause && <p className="mt-1 text-xs leading-relaxed text-muted">{selectedPath.inspection.cause}</p>}
                    <p className="mt-3 font-mono text-[9px] text-text-dim">{Math.round(selectedPath.inspection.confidence * 100)}% confidence · deterministic host evidence</p>
                  </div>
                )}
              </StageSection>

              <StageSection number="03" label="Test" icon={<TestTube2 size={16} />} state={selectedPath.verification.status === "passed" ? "complete" : selectedPath.verification.status === "not_run" ? "pending" : "attention"} summary="Verify the outcome from outside the container">
                <div className="flex flex-col gap-4 border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <PathStatus status={selectedPath.verification.status} />
                    <p className="mt-2 break-all font-mono text-[10px] text-muted">{selectedPath.verification.target || `https://${selectedPath.domain}/`}</p>
                    <p className="mt-1 text-xs text-muted">{probeDetail(selectedPath.verification)}</p>
                  </div>
                  <a href={`https://${selectedPath.domain}/`} target="_blank" rel="noreferrer" className="gc-button shrink-0">
                    Open endpoint <ExternalLink size={13} />
                  </a>
                </div>
                <details className="mt-3 border-t border-border pt-3 text-[10px] text-muted">
                  <summary className="cursor-pointer font-medium text-foreground">What this check proves</summary>
                  <p className="mt-2 leading-relaxed">This proves external HTTP reachability. Authentication, checkout, and other product journeys are verified only after you configure them.</p>
                </details>
              </StageSection>

              <StageSection number="04" label="Diagnose" icon={<Sparkles size={16} />} state={run?.investigation || selectedPath.inspection ? selectedPath.inspection?.outcome === "failed" ? "attention" : "complete" : "pending"} summary="Explain the cause and choose the next justified action">
                {selectedPath.inspection && <AutomaticDiagnosis inspection={selectedPath.inspection} />}
                <div className="flex flex-col gap-3 border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{run ? `Deep investigation ${run.id}` : "Deterministic isolation is automatic"}</p>
                    <p className="mt-1 text-xs text-muted">{run ? `Current state: ${humanize(run.state)}` : selectedPath.inspection?.deepInvestigation?.reason || "Scan the host to collect live evidence."}</p>
                  </div>
                  {selectedPath.inspection?.deepInvestigation?.geminiEligible && (
                    <Button onClick={runInvestigation} disabled={loading || changeSets.length === 0} leadingIcon={<Sparkles size={14} />}>
                      {operation === "investigate" ? "Correlating…" : run ? "Correlate again" : "Deepen with Gemini"}
                    </Button>
                  )}
                </div>
                {run?.investigation ? <InvestigationView investigation={run.investigation} /> : run?.state === "remembered" ? (
                  <Notice className="mt-4" tone="success" title="No failure confirmed">The selected public journey passed, so this run ended after verification and recorded the healthy result.</Notice>
                ) : null}
              </StageSection>

              <StageSection number="05" label="Recover" icon={<Wrench size={16} />} state={run?.actionPlan || selectedPath.inspection?.nextAction ? "attention" : run?.state === "remembered" || selectedPath.inspection?.outcome === "healthy" ? "complete" : "pending"} summary="Prepare the smallest reversible action under policy">
                {run?.actionPlan ? (
                  <RecoveryPlanView plan={run.actionPlan} runState={run.state} recoveryReady={recoveryReady} loading={operation === "recover"} onApprove={approveRecovery} />
                ) : selectedPath.inspection?.nextAction ? (
                  <NextActionView action={selectedPath.inspection.nextAction} />
                ) : (
                  <Notice tone={run?.state === "remembered" || selectedPath.inspection?.outcome === "healthy" ? "success" : "neutral"} title={run?.state === "remembered" || selectedPath.inspection?.outcome === "healthy" ? "No recovery required" : "No safe action prepared"}>
                    {run?.state === "remembered" || selectedPath.inspection?.outcome === "healthy" ? "The external check passed; mutating this host would be unjustified." : "A recovery plan appears only when evidence supports an allowlisted, reversible action."}
                  </Notice>
                )}
              </StageSection>

              <StageSection number="06" label="Verify" icon={<ShieldCheck size={16} />} state={verificationState(run)} summary="Re-run the customer outcome and roll back if proof fails">
                <JourneyResults title="Initial customer test" results={run?.journeyResults || []} />
                <JourneyResults className="mt-4" title="Post-recovery verification" results={run?.verification || []} />
                {run?.state === "rolling_back" && <Notice className="mt-4" tone="warning" title="Verification failed">GroundControl is reversing the attempted change before continuing investigation.</Notice>}
              </StageSection>

              <StageSection number="07" label="Remember" icon={<Fingerprint size={16} />} state={run?.state === "remembered" ? "complete" : "pending"} summary="Retain the evidence chain and successful outcome">
                {run?.auditLog?.length ? (
                  <div className="divide-y divide-border border border-border">
                    {run.auditLog.map((entry, index) => (
                      <div key={`${entry.at}-${index}`} className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_180px_minmax(0,1fr)]">
                        <span className="font-mono text-[9px] text-text-dim">{formatTime(entry.at)}</span>
                        <span className="font-mono text-[10px]">{humanize(entry.action)}</span>
                        <span className="text-[10px] text-muted">{entry.detail || "State transition recorded"}</span>
                      </div>
                    ))}
                  </div>
                ) : <Notice>No Loop audit trail exists for this path yet.</Notice>}
                {!persistenceReady && <Notice className="mt-4" tone="warning" title="Memory limitation">Current Loop memory is process-local and resets when the GroundControl process restarts. The interface does not present it as durable operational memory.</Notice>}
              </StageSection>
            </main>
          )}
        </div>
      ) : null}

      {graphMeta?.readiness?.length ? (
        <details className="mt-8 border border-border bg-card">
          <summary className="cursor-pointer px-5 py-4 text-xs font-medium">Capability readiness and limits</summary>
          <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {graphMeta.readiness.map((item) => (
              <div key={item.id} className="bg-card p-4">
                <StatusBadge tone={item.ready ? "success" : "warning"}>{item.ready ? "Ready" : "Not ready"}</StatusBadge>
                <p className="mt-3 text-xs font-medium">{item.label}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function StageRail({ run, selectedPath, hasGraph }: { run: LoopRun | null; selectedPath: ServicePath | null; hasGraph: boolean }) {
  return (
    <div className="mt-6 overflow-x-auto border border-border bg-card" aria-label="Loop investigation stages">
      <div className="grid min-w-[760px] grid-cols-7">
        {LOOP_STAGES.map(([number, label], index) => {
          const active = stageReached(index, run, selectedPath, hasGraph);
          return (
            <div key={number} className={`relative border-r border-border px-3 py-3 last:border-r-0 ${active ? "bg-accent/[0.07]" : ""}`}>
              <span className={`font-mono text-[9px] ${active ? "text-accent" : "text-text-dim"}`}>{number}</span>
              <p className={`mt-1 text-[11px] font-medium ${active ? "text-foreground" : "text-muted"}`}>{label}</p>
              {active && <span className="absolute inset-x-0 bottom-0 h-px bg-accent" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageSection({ number, label, icon, state, summary, children }: { number: string; label: string; icon: ReactNode; state: "complete" | "attention" | "pending"; summary: string; children: ReactNode }) {
  return (
    <section className="border-b border-border last:border-b-0">
      <div className="flex items-start gap-3 border-b border-border bg-background/30 px-4 py-4 sm:px-5">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border ${state === "complete" ? "border-success/35 text-success" : state === "attention" ? "border-warning/40 text-warning" : "border-border text-muted"}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[9px] text-text-dim">{number}</span>
            <h2 className="text-sm font-semibold">{label}</h2>
            <StatusBadge tone={state === "complete" ? "success" : state === "attention" ? "warning" : "neutral"}>{state === "complete" ? "Complete" : state === "attention" ? "Needs attention" : "Pending"}</StatusBadge>
          </div>
          <p className="mt-1 text-[11px] text-muted">{summary}</p>
        </div>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function RelationshipChain({ path }: { path: ServicePath }) {
  const items = path.inspection?.evidence || [
    {
      id: "proxy" as const,
      label: "Proxy route",
      value: path.upstream || "No target",
      status: path.upstream ? "observed" as const : "failed" as const,
      detail: "Scan the host to verify the route and customer outcome.",
    },
  ];
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[520px] items-stretch">
        {items.map((item, index) => (
          <div key={item.id} className="flex min-w-0 flex-1 items-center">
            <div className={`h-full min-w-[150px] flex-1 border p-3 ${item.status === "failed" ? "border-error/40 bg-error/[0.035]" : "border-border"}`}>
              <PathNodeStatus status={item.status} />
              <p className="mt-3 font-mono text-[9px] uppercase text-text-dim">{item.label}</p>
              <p className="mt-1 break-all text-[11px] font-medium">{item.value}</p>
              <p className="mt-1 text-[9px] leading-relaxed text-muted">{item.detail}</p>
            </div>
            {index < items.length - 1 && <ArrowDown className="mx-1 h-3.5 w-3.5 shrink-0 -rotate-90 text-text-dim" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function AutomaticDiagnosis({ inspection }: { inspection: PathInspection }) {
  return (
    <div className={`mb-4 border p-4 ${inspection.outcome === "failed" ? "border-error/35 bg-error/[0.035]" : inspection.outcome === "healthy" ? "border-success/30 bg-success/[0.03]" : "border-warning/35 bg-warning/[0.03]"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="gc-eyebrow">{inspection.failureBoundary ? `Isolated at ${humanize(inspection.failureBoundary)}` : "Automatic diagnosis"}</p>
          <p className="mt-2 text-sm font-semibold">{inspection.summary}</p>
          {inspection.cause && <p className="mt-1 text-xs leading-relaxed text-muted">{inspection.cause}</p>}
        </div>
        <StatusBadge tone={inspection.outcome === "healthy" ? "success" : inspection.outcome === "failed" ? "danger" : "warning"}>
          {Math.round(inspection.confidence * 100)}% confidence
        </StatusBadge>
      </div>
      {inspection.deepInvestigation?.daytonaEligible && (
        <p className="mt-3 border-t border-border pt-3 text-[10px] text-muted">Daytona is eligible only after Gemini and live evidence isolate this to a repository or configuration regression.</p>
      )}
    </div>
  );
}

function NextActionView({ action }: { action: NonNullable<PathInspection["nextAction"]> }) {
  return (
    <div className="border border-border">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="gc-eyebrow">Next safe action</p>
          <h3 className="mt-2 text-sm font-semibold">{action.title}</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">{action.detail}</p>
        </div>
        <StatusBadge tone={action.mode === "automatic" ? "success" : action.mode === "approval" ? "warning" : "neutral"}>
          {action.mode === "approval" ? "Approval gated" : humanize(action.mode)}
        </StatusBadge>
      </div>
      <div className="border-t border-border px-4 py-3 text-[10px] text-muted">
        GroundControl will not guess or restart unrelated services. A mutation becomes available only after the target and rollback are exact.
      </div>
    </div>
  );
}

function InvestigationView({ investigation }: { investigation: NonNullable<LoopRun["investigation"]> }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="border border-border p-4">
        <p className="gc-eyebrow">Customer impact</p>
        <p className="mt-2 text-sm font-medium">{investigation.symptom}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{investigation.customerImpact}</p>
        <p className="mt-3 font-mono text-[9px] text-text-dim">Provider: {humanize(investigation.provider)}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="border border-border">
          <div className="border-b border-border px-4 py-3"><p className="gc-eyebrow">Hypotheses</p></div>
          <div className="divide-y divide-border">
            {investigation.hypotheses.map((hypothesis) => (
              <div key={hypothesis.id} className="p-4">
                <div className="flex items-start gap-2">
                  {hypothesis.status === "confirmed" ? <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={14} /> : hypothesis.status === "rejected" ? <XCircle className="mt-0.5 shrink-0 text-error" size={14} /> : <AlertTriangle className="mt-0.5 shrink-0 text-warning" size={14} />}
                  <div>
                    <p className="text-[11px] leading-relaxed">{hypothesis.statement}</p>
                    <p className="mt-1 font-mono text-[9px] text-muted">{Math.round(hypothesis.confidence * 100)}% · {hypothesis.status} · {hypothesis.supportingEvidenceIds.length} supporting · {hypothesis.contradictingEvidenceIds.length} contradicting</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border border-border">
          <div className="border-b border-border px-4 py-3"><p className="gc-eyebrow">Evidence and uncertainty</p></div>
          <div className="max-h-[340px] divide-y divide-border overflow-y-auto">
            {investigation.evidence.map((evidence) => (
              <div key={evidence.id} className="p-4">
                <p className="font-mono text-[9px] uppercase text-text-dim">{humanize(evidence.kind)} · {evidence.id}</p>
                <p className="mt-1 text-[11px]">{evidence.summary}</p>
              </div>
            ))}
            {investigation.uncertainty.map((item, index) => (
              <div key={`${item}-${index}`} className="flex gap-2 p-4 text-[11px] text-warning"><CircleHelp className="mt-0.5 shrink-0" size={14} />{item}</div>
            ))}
          </div>
        </div>
      </div>
      {investigation.confirmedCause && <Notice tone="warning" title="Confirmed cause">{investigation.confirmedCause}</Notice>}
    </div>
  );
}

function RecoveryPlanView({ plan, runState, recoveryReady, loading, onApprove }: { plan: ActionPlan; runState: string; recoveryReady: boolean; loading: boolean; onApprove: () => void }) {
  const canApprove = runState === "awaiting_approval" && recoveryReady;
  return (
    <div className="space-y-4">
      <div className="border border-border">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="gc-eyebrow">Proposed resolution · {humanize(plan.kind)}</p>
            <h3 className="mt-2 text-sm font-semibold">{plan.title}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{plan.description}</p>
          </div>
          <StatusBadge tone={plan.risk === "low" ? "success" : plan.risk === "medium" ? "warning" : "danger"}>{plan.risk} risk</StatusBadge>
        </div>
        <div className="grid gap-px bg-border md:grid-cols-3">
          <PlanFact label="Policy decision" value={plan.approvalRequired ? "Explicit approval required" : "Guided only"} icon={<ShieldCheck size={14} />} />
          <PlanFact label="Expected result" value={plan.expectedResult} icon={<CheckCircle2 size={14} />} />
          <PlanFact label="Exact rollback" value={plan.rollbackKind ? humanize(plan.rollbackKind) : "No automatic rollback supplied"} icon={<RotateCcw size={14} />} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border border-border p-4"><p className="gc-eyebrow">Preconditions</p><ul className="mt-3 space-y-2 text-[11px] text-muted">{plan.preconditions.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-success" size={13} />{item}</li>)}</ul></div>
        <div className="border border-border p-4"><p className="gc-eyebrow">Verification plan</p><ul className="mt-3 space-y-2 text-[11px] text-muted">{plan.verificationJourneyIds.length ? plan.verificationJourneyIds.map((item) => <li key={item} className="flex gap-2"><TestTube2 className="mt-0.5 shrink-0 text-accent" size={13} />{item}</li>) : <li>No verification journey is attached.</li>}</ul></div>
      </div>
      {!recoveryReady && <Notice tone="warning" title="Live recovery is disabled">The plan is visible and reviewable, but GroundControl will not mutate the host until the allowlisted live-recovery adapter is explicitly enabled.</Notice>}
      <Button variant="primary" onClick={onApprove} disabled={!canApprove || loading} leadingIcon={<Wrench size={14} />}>{loading ? "Applying and verifying…" : "Approve exact recovery"}</Button>
    </div>
  );
}

function JourneyResults({ title, results, className = "" }: { title: string; results: JourneyResult[]; className?: string }) {
  return (
    <div className={`border border-border ${className}`}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><p className="gc-eyebrow">{title}</p><span className="font-mono text-[9px] text-text-dim">{results.length} result(s)</span></div>
      {results.length ? <div className="divide-y divide-border">{results.map((result) => <div key={`${result.journeyId}-${result.observedAt}`} className="p-4"><div className="flex items-center justify-between gap-3"><p className="font-mono text-[10px]">{result.journeyId}</p><StatusBadge tone={result.ok ? "success" : "danger"}>{result.ok ? "Passed" : "Failed"}</StatusBadge></div><div className="mt-3 space-y-2">{result.stepResults.map((step) => <div key={step.stepIndex} className="flex items-start gap-2 text-[10px] text-muted">{step.ok ? <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={12} /> : <XCircle className="mt-0.5 shrink-0 text-error" size={12} />}<span>{step.detail}</span></div>)}</div></div>)}</div> : <p className="px-4 py-4 text-xs text-muted">No result has been recorded for this stage.</p>}
    </div>
  );
}

function SummaryCell({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "success" | "danger" }) {
  return <div className="bg-card p-4"><p className="gc-eyebrow">{label}</p><p className={`mt-2 text-xl font-semibold tracking-tight ${tone === "success" ? "text-success" : tone === "danger" ? "text-error" : ""}`}>{value}</p><p className="mt-1 text-[10px] text-muted">{detail}</p></div>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="bg-card p-4"><p className="gc-eyebrow">{label}</p><p className="mt-2 break-all font-mono text-[10px]">{value}</p></div>; }

function PlanFact({ label, value, icon }: { label: string; value: string; icon: ReactNode }) { return <div className="bg-card p-4"><span className="text-accent">{icon}</span><p className="mt-3 gc-eyebrow">{label}</p><p className="mt-2 text-[11px] leading-relaxed">{value}</p></div>; }

function PathStatus({ status, compact = false }: { status: Verification["status"]; compact?: boolean }) {
  if (status === "passed") return <StatusBadge tone="success">{compact ? "Passed" : "Public check passed"}</StatusBadge>;
  if (status === "responded") return <StatusBadge tone="warning">{compact ? "Responded" : "Public endpoint responded"}</StatusBadge>;
  if (status === "failed") return <StatusBadge tone="danger">{compact ? "Failed" : "Public check failed"}</StatusBadge>;
  return <StatusBadge tone="neutral">{compact ? "Not run" : "Public check not run"}</StatusBadge>;
}

function PathNodeStatus({ status }: { status: "verified" | "observed" | "failed" }) {
  if (status === "verified") return <span className="flex items-center gap-1 font-mono text-[8px] uppercase text-success"><CheckCircle2 size={11} />Verified</span>;
  if (status === "observed") return <span className="flex items-center gap-1 font-mono text-[8px] uppercase text-accent"><CheckCircle2 size={11} />Observed</span>;
  return <span className="flex items-center gap-1 font-mono text-[8px] uppercase text-error"><XCircle size={11} />Failed here</span>;
}

function probeDetail(verification: Verification) {
  if (verification.status === "passed") return `HTTP ${verification.statusCode || "success"} in ${verification.latencyMs ?? "unknown"}ms · ${formatTime(verification.observedAt)}`;
  if (verification.status === "responded") return `HTTP ${verification.statusCode} reached the application in ${verification.latencyMs ?? "unknown"}ms, but it did not match the default root-path expectation.`;
  if (verification.status === "failed") return verification.error || `HTTP ${verification.statusCode || "failure"} in ${verification.latencyMs ?? "unknown"}ms`;
  return "Run Scan host to execute a real external reachability check.";
}

function verificationState(run: LoopRun | null): "complete" | "attention" | "pending" {
  if (!run) return "pending";
  if (run.state === "rolling_back" || run.state === "failed") return "attention";
  if (run.state === "remembered" || run.state === "recovered" || run.verification?.length) return "complete";
  return "pending";
}

function stageReached(index: number, run: LoopRun | null, path: ServicePath | null, hasGraph: boolean) {
  if (index === 0) return hasGraph;
  if (index === 1) return Boolean(path);
  if (index === 2) return path?.verification?.status !== "not_run";
  if (index === 3) return Boolean(run || path?.inspection);
  if (index === 4) return Boolean(run?.actionPlan || path?.inspection?.nextAction) || run?.state === "remembered";
  if (index === 5) return verificationState(run) === "complete";
  return run?.state === "remembered";
}

function humanize(value: string) { return value.replace(/[_:]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function formatTime(value?: string) {
  if (!value) return "not observed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleString();
}
