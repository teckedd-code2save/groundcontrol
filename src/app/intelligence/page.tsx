"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  SearchCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, Notice, StatusBadge } from "@/components/ui";
import {
  incidentRecoveryOutcome,
  narrativeRequestsAction,
  operatorNarrativeIsComplete,
  parseOperatorNarrative,
} from "@/lib/operator-progress";

type Verification = {
  status: "passed" | "responded" | "failed" | "not_run";
  statusCode?: number;
  latencyMs?: number;
  error?: string;
  observedAt?: string;
  target?: string;
};

type PathInspection = {
  outcome: "healthy" | "degraded" | "failed";
  failureBoundary?: "edge" | "proxy_to_upstream" | "upstream" | "application";
  summary: string;
  cause?: string;
  confidence: number;
  evidence: Array<{
    id: string;
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
};

type ServicePath = {
  domain: string;
  upstream?: string;
  containerName?: string;
  containerState?: string;
  serviceId?: string;
  topologyStatus?: "linked" | "partial";
  verification: Verification;
  inspection?: PathInspection;
};

type ReadinessItem = { id: string; label: string; ready: boolean; detail: string };

type GraphState = {
  hostId: string;
  reconciledAt: string;
  paths: ServicePath[];
  readiness: ReadinessItem[];
};

type IncidentInvestigation = {
  status: "resolved" | "ambiguous" | "unresolved";
  domain: string;
  problem: string;
  fix: string;
  verify: string;
  target?: {
    deploymentSlug: string;
    deploymentName: string;
    sourcePath?: string | null;
    composePath?: string | null;
    composeProject?: string | null;
    composeServices: string[];
    containers: string[];
    runtimeStatus: string;
    proxyRoute?: string | null;
    repository?: string | null;
    deployedCommit?: string | null;
  };
  action?: { projectSlug: string; title: string; risk: string; rollback: string } | null;
  uncertainty?: string[];
};

type AgentToolEvent = {
  name: string;
  status: "running" | "success" | "error" | "pending";
  output?: string;
  args?: Record<string, unknown>;
};

type AgentConfirmation = {
  name: string;
  args: Record<string, unknown>;
  description: string;
};

export default function IntelligencePage() {
  const [graph, setGraph] = useState<GraphState | null>(null);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [investigation, setInvestigation] = useState<IncidentInvestigation | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const [showHealthy, setShowHealthy] = useState(false);
  const [agentText, setAgentText] = useState("");
  const [agentTools, setAgentTools] = useState<AgentToolEvent[]>([]);
  const [agentConfirm, setAgentConfirm] = useState<AgentConfirmation | null>(null);
  const [agentThreadId, setAgentThreadId] = useState<number | null>(null);
  const [diagnosisStartedAt, setDiagnosisStartedAt] = useState<number | null>(null);
  const [diagnosisElapsed, setDiagnosisElapsed] = useState(0);
  const [linkedIncident, setLinkedIncident] = useState<ServicePath | null>(null);
  const booted = useRef(false);

  const paths = useMemo(() => {
    const discovered = graph?.paths || [];
    if (!linkedIncident) return discovered;
    return [linkedIncident, ...discovered.filter((path) => path.domain !== linkedIncident.domain)];
  }, [graph?.paths, linkedIncident]);
  const incidentPaths = useMemo(() => paths.filter((path) => path.verification.status !== "passed"), [paths]);
  const visiblePaths = showHealthy ? paths : incidentPaths;
  const selectedPath = useMemo(
    () => visiblePaths.find((path) => path.domain === selectedDomain) || visiblePaths[0] || null,
    [visiblePaths, selectedDomain]
  );

  const refresh = useCallback(async (scan = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/intelligence/graph", scan ? { method: "POST" } : undefined);
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "GroundControl could not inspect this host.");
      const nextPaths = Array.isArray(data.paths) ? data.paths as ServicePath[] : [];
      setGraph({
        hostId: String(data.hostId || ""),
        reconciledAt: String(data.reconciledAt || ""),
        paths: nextPaths,
        readiness: Array.isArray(data.readiness) ? data.readiness : [],
      });
      setSelectedDomain((current) => {
        const requested = typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("domain") || ""
          : "";
        if (requested) return requested;
        return nextPaths.some((path) => path.domain === current) ? current : nextPaths[0]?.domain || "";
      });
      setInvestigation(null);
      setAgentText("");
      setAgentTools([]);
      setAgentConfirm(null);
      setAgentThreadId(null);
      setDiagnosisStartedAt(null);
      setDiagnosisElapsed(0);
      return nextPaths;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "GroundControl could not inspect this host.");
      return [] as ServicePath[];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!investigating || !diagnosisStartedAt) return;
    const update = () => setDiagnosisElapsed(Math.max(0, Math.floor((Date.now() - diagnosisStartedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [diagnosisStartedAt, investigating]);

  const failed = paths.filter((path) => path.verification.status === "failed").length;
  const healthy = paths.filter((path) => path.verification.status === "passed").length;
  const hostEvidence = graph?.readiness.find((item) => item.id === "host");

  async function investigate(path: ServicePath) {
    setInvestigating(true);
    setDiagnosisStartedAt(Date.now());
    setDiagnosisElapsed(0);
    setError(null);
    setInvestigation(null);
    try {
      const response = await fetch("/api/intelligence/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: path.domain }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "GroundControl could not resolve this incident.");
      const resolved = data as IncidentInvestigation;
      setInvestigation(resolved);
      if (resolved.status === "resolved" && resolved.target) {
        await runIncidentAgent(resolved, path);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "GroundControl could not resolve this incident.");
    } finally {
      setInvestigating(false);
    }
  }

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const params = new URLSearchParams(window.location.search);
    const domain = params.get("domain")?.trim() || "";
    if (!domain) {
      void refresh();
      return;
    }

    const deployment = params.get("deployment")?.trim() || domain;
    const stage = params.get("stage")?.trim() || "deployment";
    const failure = params.get("error")?.trim() || "The deployment run failed before verification.";
    const linked: ServicePath = {
      domain,
      topologyStatus: "partial",
      verification: {
        status: "failed",
        error: failure,
        observedAt: new Date().toISOString(),
        target: domain,
      },
      inspection: {
        outcome: "failed",
        failureBoundary: "application",
        summary: `${deployment} failed during ${stage}.`,
        cause: failure,
        confidence: 1,
        evidence: [{
          id: "deployment-run",
          label: "Deployment run",
          value: stage,
          detail: failure,
          status: "failed",
        }],
        nextAction: {
          title: "Investigate the failed deployment",
          detail: "Inspect the locked deployment, its Compose runtime, and recorded failure evidence.",
          mode: "guided",
        },
      },
    };
    setLinkedIncident(linked);
    setSelectedDomain(domain);

    void (async () => {
      const scanned = await refresh(true);
      const discovered = scanned.find(
        (path) => path.domain === domain && path.verification.status !== "passed"
      );
      const incident = discovered || linked;
      setLinkedIncident(incident);
      setSelectedDomain(domain);
      if (params.get("autostart") === "1") {
        await investigate(incident);
      }
    })();
    // This is an intentional one-shot handoff from the deployment URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runIncidentAgent(
    resolved: IncidentInvestigation,
    path: ServicePath,
    confirmedTool?: { name: string; args: Record<string, unknown> },
    continuationMessage?: string
  ) {
    setInvestigating(true);
    if (!confirmedTool && !continuationMessage) {
      setAgentText("");
      setAgentTools([]);
      setAgentConfirm(null);
    } else {
      setAgentConfirm(null);
    }
    const target = resolved.target!;
    const body: Record<string, unknown> = {
      threadId: agentThreadId,
      incidentContext: {
        domain: resolved.domain,
        deploymentSlug: target.deploymentSlug,
        sourcePath: target.sourcePath,
        composePath: target.composePath,
        repository: target.repository,
        deployedCommit: target.deployedCommit,
      },
    };
    if (confirmedTool) body.confirmedTool = confirmedTool;
    else if (continuationMessage) body.message = continuationMessage;
    else {
      body.message = [
        `Resolve the production failure for https://${resolved.domain}/.`,
        `Observed boundary: ${path.inspection?.failureBoundary || "unresolved"}.`,
        `Observed cause: ${path.inspection?.cause || path.inspection?.summary || resolved.problem}.`,
        `Configured upstream: ${path.upstream || target.proxyRoute || "unresolved"}.`,
        "Act as the dedicated incident SRE. Investigate the exact locked deployment only.",
        "For Compose failures, inspect the declared dependency chain, all containers including exited one-shots, bounded failure logs, environment schema, route and recent release.",
        "If source-related, reproduce and validate the smallest repair in Daytona and prepare the confirmation-gated PR.",
        "If runtime-only, prepare the smallest typed reversible action.",
        `Verify https://${resolved.domain}/ externally before reporting recovery.`,
      ].join("\n");
    }
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "The incident agent could not start.");
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = confirmedTool || continuationMessage ? agentText : "";
      const handleEvent = (event: Record<string, unknown>) => {
        if (event.type === "thread") setAgentThreadId(Number(event.threadId));
        if (event.type === "text") {
          answer += String(event.delta || "");
          setAgentText(answer);
        }
        if (event.type === "confirm") {
          setAgentConfirm({
            name: String(event.name || ""),
            args: (event.args || {}) as Record<string, unknown>,
            description: String(event.description || "Approval required"),
          });
        }
        if (event.type === "tool") {
          const wireStatus = String(event.status || "running");
          const status: AgentToolEvent["status"] =
            wireStatus === "done" ? "success"
              : wireStatus === "error" ? "error"
                : wireStatus === "pending" ? "pending"
                  : "running";
          const next: AgentToolEvent = {
            name: String(event.name || ""),
            status,
            output: typeof event.output === "string" ? event.output : undefined,
            args: (event.args || {}) as Record<string, unknown>,
          };
          setAgentTools((current) => {
            const index = current.findIndex((item) => item.name === next.name && item.status === "running");
            if (index < 0) return [...current, next];
            const copy = [...current];
            copy[index] = next;
            return copy;
          });
        }
        if (event.type === "error") throw new Error(String(event.error || "Incident agent failed."));
      };
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) handleEvent(JSON.parse(line));
          }
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Incident agent failed.");
    } finally {
      setInvestigating(false);
    }
  }

  return (
    <div className="gc-page gc-page--wide">
      <PageHeader
        eyebrow="Intelligence"
        title="Recover a broken deployment"
        description="Choose a customer-facing failure. GroundControl locks the exact workload, builds an evidence chain, prepares the safest repair, and verifies the result from outside the host."
        actions={(
          <Button
            variant="primary"
            onClick={() => refresh(true)}
            disabled={loading}
            leadingIcon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
          >
            {loading ? "Refreshing…" : "Refresh endpoints"}
          </Button>
        )}
      />

      {error && <Notice className="mt-5" tone="danger" title="Check failed">{error}</Notice>}

      {incidentPaths.length === 0 && loading ? (
        <section className="mt-6 border border-border bg-card px-5 py-8" aria-live="polite">
          <div className="flex items-start gap-4">
            <RefreshCw size={18} className="mt-0.5 shrink-0 animate-spin text-accent" />
            <div>
              <p className="text-sm font-semibold">Checking deployment paths</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Resolving public endpoints, proxy routes, deployment identity, and runtime evidence.
              </p>
            </div>
          </div>
          <div className="mt-5 h-1 overflow-hidden bg-border">
            <div className="h-full w-2/3 bg-accent motion-safe:animate-pulse" />
          </div>
        </section>
      ) : incidentPaths.length === 0 && !loading ? (
        <EmptyState
          className="mt-6"
          icon={<Activity size={22} />}
          title="No broken deployments"
          description="No customer-facing failure currently needs an investigation."
          action={<Button variant="primary" onClick={() => refresh(true)} leadingIcon={<SearchCheck size={14} />}>Check host</Button>}
        />
      ) : incidentPaths.length > 0 ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border py-3 text-xs">
            <span><strong className="text-foreground">{incidentPaths.length}</strong> incidents</span>
            <span className="text-error"><strong>{failed}</strong> failing</span>
            <span className="text-success"><strong>{healthy}</strong> healthy</span>
            <button type="button" onClick={() => setShowHealthy((value) => !value)} className="text-muted hover:text-foreground">
              {showHealthy ? "Hide healthy" : `View healthy (${healthy})`}
            </button>
            <span className="text-muted">Checked {formatTime(graph?.reconciledAt)}</span>
            <span className="ml-auto">
              <StatusBadge tone={hostEvidence?.ready ? "success" : "warning"}>
                {hostEvidence?.ready ? "Host evidence ready" : "Host evidence unavailable"}
              </StatusBadge>
            </span>
          </div>

          <div className={`mt-5 grid min-w-0 gap-5 ${investigation ? "lg:grid-cols-[210px_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)]"}`}>
            <aside className="min-w-0 border border-border bg-card lg:sticky lg:top-20 lg:self-start">
              <div className="border-b border-border px-4 py-3">
                <p className="text-xs font-semibold">{investigation ? "Switch incident" : "Broken deployments"}</p>
                <p className="mt-1 text-[10px] text-muted">Customer impact first</p>
              </div>
              <div className="max-h-[620px] divide-y divide-border overflow-y-auto">
                {[...visiblePaths].sort(pathPriority).map((path) => (
                  <button
                    key={path.domain}
                    type="button"
                    onClick={() => {
                      setSelectedDomain(path.domain);
                      if (investigation?.domain !== path.domain) {
                        setInvestigation(null);
                        setAgentText("");
                        setAgentTools([]);
                        setAgentConfirm(null);
                        setAgentThreadId(null);
                      }
                    }}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      selectedPath?.domain === path.domain ? "bg-accent/[0.08]" : "hover:bg-white/[0.025]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <PathIcon status={path.verification.status} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{path.domain}</span>
                      <span className="font-mono text-[9px] text-muted">{shortStatus(path.verification)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            {selectedPath && (
              <main className="min-w-0">
                <ResolutionSurface
                  path={selectedPath}
                  onFix={() => investigate(selectedPath)}
                  onRescan={() => refresh(true)}
                  loading={loading}
                  investigating={investigating}
                  investigation={investigation?.domain === selectedPath.domain ? investigation : null}
                  agentText={agentText}
                  agentTools={agentTools}
                  agentConfirm={agentConfirm}
                  onApproveAgent={() => agentConfirm && investigation && runIncidentAgent(investigation, selectedPath, { name: agentConfirm.name, args: agentConfirm.args })}
                  onCancelAgent={() => setAgentConfirm(null)}
                  onPrepareAgentAction={() => investigation && runIncidentAgent(
                    investigation,
                    selectedPath,
                    undefined,
                    "Your previous conclusion requested operator confirmation without creating a typed action. Continue this locked investigation now. Call the exact confirmation-gated tool for the proposed mutation, or state one concrete blocker. Do not ask for confirmation in prose."
                  )}
                  onContinueAgent={() => investigation && runIncidentAgent(
                    investigation,
                    selectedPath,
                    undefined,
                    "The previous automatic pass ended without a complete evidence-backed outcome. Continue the same locked investigation now. Do not stop at a refused or failed generic tool; use the dedicated read-only tools, preserve successful evidence, and finish with a typed safe action, a Daytona-validated source repair, or one concrete blocker under Problem, Fix, Verify."
                  )}
                  diagnosisElapsed={diagnosisElapsed}
                  onExitFocus={() => setInvestigation(null)}
                />
              </main>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ResolutionSurface({
  path,
  onFix,
  onRescan,
  loading,
  investigating,
  investigation,
  agentText,
  agentTools,
  agentConfirm,
  onApproveAgent,
  onCancelAgent,
  onPrepareAgentAction,
  onContinueAgent,
  diagnosisElapsed,
  onExitFocus,
}: {
  path: ServicePath;
  onFix: () => void;
  onRescan: () => void;
  loading: boolean;
  investigating: boolean;
  investigation: IncidentInvestigation | null;
  agentText: string;
  agentTools: AgentToolEvent[];
  agentConfirm: AgentConfirmation | null;
  onApproveAgent: () => void;
  onCancelAgent: () => void;
  onPrepareAgentAction: () => void;
  onContinueAgent: () => void;
  diagnosisElapsed: number;
  onExitFocus: () => void;
}) {
  const inspection = path.inspection;
  const isHealthy = path.verification.status === "passed";
  const isFailed = path.verification.status === "failed";

  return (
    <section className="border border-border bg-card">
      <div className={`border-b px-5 py-5 sm:px-6 ${isFailed ? "border-error/35 bg-error/[0.035]" : "border-border"}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={isHealthy ? "success" : isFailed ? "danger" : "warning"}>
                {isHealthy ? "Healthy" : isFailed ? "Down" : "Needs check"}
              </StatusBadge>
              <span className="font-mono text-[10px] text-muted">{probeResult(path.verification)}</span>
            </div>
            <h2 className="mt-4 break-all text-xl font-semibold tracking-tight">{path.domain}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
              {inspection?.summary || "Check this endpoint to isolate the failure."}
            </p>
          </div>
          <a href={`https://${path.domain}/`} target="_blank" rel="noreferrer" className="gc-button shrink-0">
            Open site <ExternalLink size={13} />
          </a>
        </div>
      </div>

      {isFailed ? (
        <div className="p-5 sm:p-6">
          <div className="grid gap-px border border-border bg-border md:grid-cols-2">
            <div className="bg-card p-4">
              <p className="gc-eyebrow">Problem</p>
              <p className="mt-2 text-sm font-semibold">{inspection?.cause || "The public endpoint is failing."}</p>
              <p className="mt-2 font-mono text-[10px] text-muted">
                {path.upstream || "No upstream"} · {humanize(inspection?.failureBoundary || "unresolved")}
              </p>
            </div>
            <div className="bg-card p-4">
              <p className="gc-eyebrow">Fix</p>
              <p className="mt-2 text-sm font-semibold">{inspection?.nextAction?.title || "Investigate the live host"}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                {inspection?.nextAction?.detail || "GroundControl will identify the runtime and prepare the smallest safe repair."}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 border border-border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Run safe recovery</p>
              <p className="mt-1 text-[11px] text-muted">
                One locked run collects evidence, chooses a reversible runtime action or a Daytona-validated source repair, and verifies the public result.
              </p>
            </div>
            <Button variant="primary" onClick={onFix} disabled={investigating} leadingIcon={<Wrench size={14} />}>
              {investigating ? "Recovery running…" : "Start recovery"}
            </Button>
          </div>

          {investigating && !investigation && (
            <div className="mt-4 border border-border px-4 py-3" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-[10px]">
                <span className="font-mono text-accent">Locking deployment and collecting evidence</span>
                <span className="font-mono text-muted">{formatElapsed(diagnosisElapsed)}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden bg-border">
                <div className="h-full w-2/3 bg-accent motion-safe:animate-pulse" />
              </div>
            </div>
          )}

          {investigation && (
            <>
              <IncidentResult investigation={investigation} onExitFocus={onExitFocus} />
              <IncidentAgent
                tools={agentTools}
                text={agentText}
                confirmation={agentConfirm}
                running={investigating}
                onApprove={onApproveAgent}
                onCancel={onCancelAgent}
                onPrepareAction={onPrepareAgentAction}
                onContinue={onContinueAgent}
                elapsed={diagnosisElapsed}
              />
            </>
          )}

          <details className="mt-4 border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-medium">
              Evidence
              <ChevronDown size={14} className="text-muted" />
            </summary>
            <div className="divide-y divide-border border-t border-border">
              {(inspection?.evidence || []).map((item) => (
                <div key={item.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[120px_160px_minmax(0,1fr)] sm:items-start">
                  <span className={`font-mono text-[9px] ${item.status === "failed" ? "text-error" : item.status === "verified" ? "text-success" : "text-accent"}`}>
                    {item.status}
                  </span>
                  <span className="break-all text-[11px] font-medium">{item.label}: {item.value}</span>
                  <span className="text-[10px] leading-relaxed text-muted">{item.detail}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      ) : isHealthy ? (
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
            <div>
              <p className="text-sm font-semibold">No action needed</p>
              <p className="mt-1 text-[11px] text-muted">The endpoint passed its public check.</p>
            </div>
          </div>
          <Button onClick={onRescan} disabled={loading} leadingIcon={<RefreshCw size={13} />}>Check again</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <p className="text-sm text-muted">This endpoint responded, but its expected customer outcome has not been configured.</p>
          <Button onClick={onFix} leadingIcon={<SearchCheck size={13} />}>Inspect path</Button>
        </div>
      )}
    </section>
  );
}

function IncidentResult({ investigation, onExitFocus }: { investigation: IncidentInvestigation; onExitFocus: () => void }) {
  const target = investigation.target;
  return (
    <div className="mt-4 border border-border">
      <div className="grid gap-px bg-border md:grid-cols-3">
        {(["Problem", "Fix", "Verify"] as const).map((label) => (
          <div key={label} className="bg-card p-4">
            <p className="gc-eyebrow">{label}</p>
            <p className="mt-2 text-xs leading-relaxed">{investigation[label.toLowerCase() as "problem" | "fix" | "verify"]}</p>
          </div>
        ))}
      </div>
      {target && (
        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold">{target.deploymentName}</p><p className="mt-1 font-mono text-[10px] text-muted">{target.deploymentSlug}</p></div>
            <div className="flex gap-2">
              <button type="button" onClick={onExitFocus} className="gc-button gc-button-quiet">Back to incidents</button>
              <a href={`/deployments/${target.deploymentSlug}?tab=deploy`} className="gc-button">Open deploy run</a>
            </div>
          </div>
          <p className="mt-3 break-all font-mono text-[10px] text-muted">{target.composePath || target.sourcePath || "Compose source not discovered"} · {target.composeServices.join(", ") || "No service resolved"} · {target.proxyRoute || "No route resolved"}</p>
          {investigation.action && <Notice className="mt-4" tone="warning" title={`Approval required · ${investigation.action.title}`}>Exact target: {investigation.action.projectSlug}. Risk: {investigation.action.risk}. Rollback: {investigation.action.rollback}.</Notice>}
        </div>
      )}
      {investigation.uncertainty && investigation.uncertainty.length > 0 && <div className="border-t border-border p-3 text-[10px] text-muted">Uncertainty: {investigation.uncertainty.join(" ")}</div>}
    </div>
  );
}

function IncidentAgent({
  tools,
  text,
  confirmation,
  running,
  onApprove,
  onCancel,
  onPrepareAction,
  onContinue,
  elapsed,
}: {
  tools: AgentToolEvent[];
  text: string;
  confirmation: AgentConfirmation | null;
  running: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onPrepareAction: () => void;
  onContinue: () => void;
  elapsed: number;
}) {
  const sections = parseOperatorNarrative(text);
  const missingTypedAction = !running && !confirmation && narrativeRequestsAction(text);
  const completeNarrative = operatorNarrativeIsComplete(text);
  const lastTool = tools.at(-1);
  const incompleteInvestigation =
    !running &&
    !confirmation &&
    !missingTypedAction &&
    (lastTool?.status === "error" || !completeNarrative);
  const outcome = incidentRecoveryOutcome(tools, text, confirmation?.name);
  const completedTools = tools.filter((tool) => tool.status === "success" || tool.status === "error").length;
  const progressLabel = confirmation
    ? "Awaiting approval"
    : running
      ? tools.length === 0 ? "Locking target" : `Collecting evidence · ${completedTools} checks`
      : missingTypedAction
        ? "Action incomplete"
        : incompleteInvestigation
          ? "Investigation incomplete"
          : outcome?.title || "Recovery outcome ready";
  const outcomeBadge = outcome?.kind === "verified"
    ? "Recovered"
    : outcome?.kind === "source-repair"
      ? "Repair ready"
      : outcome?.kind === "action-ready"
        ? "Action ready"
        : "Decision ready";
  return (
    <section className="mt-4 border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="gc-eyebrow">Recovery run</p>
          <p className="mt-1 text-xs font-medium">{progressLabel}</p>
        </div>
        <StatusBadge tone={running || confirmation || missingTypedAction || incompleteInvestigation ? "warning" : "neutral"}>
          {running
            ? "Running"
            : confirmation
              ? "Awaiting approval"
              : missingTypedAction
                ? "Action incomplete"
                : incompleteInvestigation
                  ? "Incomplete"
                  : outcomeBadge}
        </StatusBadge>
      </div>
      {(running || confirmation) && (
        <div className="border-b border-border px-4 py-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[10px]">
            <span className="font-mono text-accent">{progressLabel}</span>
            <span className="font-mono text-muted">{formatElapsed(elapsed)}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden bg-border">
            <div className={`h-full bg-accent ${running ? "w-2/3 motion-safe:animate-pulse" : "w-full"}`} />
          </div>
        </div>
      )}
      {outcome && !running && (
        <div className={`border-b border-border px-4 py-4 ${
          outcome.kind === "verified" ? "bg-success/[0.045]" : "bg-background/40"
        }`}>
          <div className="flex items-start gap-3">
            <CheckCircle2
              size={17}
              className={`mt-0.5 shrink-0 ${outcome.kind === "verified" ? "text-success" : "text-accent"}`}
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold">{outcome.title}</p>
              <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted">{outcome.detail}</p>
            </div>
          </div>
        </div>
      )}
      {tools.length > 0 && (
        <div className="divide-y divide-border border-b border-border">
          {tools.map((tool, index) => (
            <details key={`${tool.name}-${index}`} className="px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs">
                <span className="font-mono">{humanize(tool.name)}</span>
                <span className={`font-mono text-[9px] ${tool.status === "success" ? "text-success" : tool.status === "error" ? "text-error" : "text-accent"}`}>
                  {tool.status === "success" ? "complete" : tool.status}
                </span>
              </summary>
              {tool.output && <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap border-l border-border pl-3 font-mono text-[9px] leading-relaxed text-muted">{tool.output}</pre>}
            </details>
          ))}
        </div>
      )}
      {sections.length > 0 && (
        <div className="grid gap-px bg-border sm:grid-cols-2">
          {sections.map((section, index) => (
            <article key={`${section.title}-${index}`} className="bg-card px-4 py-4">
              <h3 className="text-xs font-semibold text-foreground">{section.title}</h3>
              <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted">
                {section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                {section.bullets.length > 0 && (
                  <ul className="space-y-1.5">
                    {section.bullets.map((bullet, bulletIndex) => (
                      <li key={bulletIndex} className="flex gap-2"><span className="text-accent">•</span><span>{bullet}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {missingTypedAction && (
        <div className="border-t border-warning/40 bg-warning/[0.04] p-4">
          <p className="text-xs font-semibold">Action was not prepared</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            The diagnosis requested confirmation without producing a scoped executable action. GroundControl does not accept prose as authorization.
          </p>
          <Button className="mt-3" variant="primary" onClick={onPrepareAction}>Prepare safe action</Button>
        </div>
      )}
      {incompleteInvestigation && (
        <div className="border-t border-warning/40 bg-warning/[0.04] p-4">
          <p className="text-xs font-semibold">The automatic investigation stopped early</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            GroundControl has retained this deployment and its evidence. Continue here; you do not need to select the incident again.
          </p>
          <Button className="mt-3" variant="primary" onClick={onContinue}>
            Continue investigation
          </Button>
        </div>
      )}
      {confirmation && (
        <div className="border-t border-warning/40 bg-warning/[0.04] p-4">
          <p className="text-xs font-semibold">Approval required</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{confirmation.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={running} onClick={onApprove}>
              {running ? "Applying…" : `Approve ${humanize(confirmation.name)}`}
            </Button>
            <Button disabled={running} onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function PathIcon({ status }: { status: Verification["status"] }) {
  if (status === "passed") return <CheckCircle2 size={13} className="shrink-0 text-success" />;
  if (status === "failed") return <XCircle size={13} className="shrink-0 text-error" />;
  return <Activity size={13} className="shrink-0 text-warning" />;
}

function pathPriority(a: ServicePath, b: ServicePath) {
  const order = { failed: 0, responded: 1, not_run: 2, passed: 3 };
  return order[a.verification.status] - order[b.verification.status] || a.domain.localeCompare(b.domain);
}

function shortStatus(verification: Verification) {
  if (verification.statusCode) return String(verification.statusCode);
  if (verification.status === "passed") return "OK";
  if (verification.status === "failed") return "DOWN";
  return "CHECK";
}

function probeResult(verification: Verification) {
  const status = verification.statusCode ? `HTTP ${verification.statusCode}` : humanize(verification.status);
  return verification.latencyMs != null ? `${status} · ${verification.latencyMs}ms` : status;
}

function humanize(value: string) {
  return value.replace(/[_:]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatTime(value?: string) {
  if (!value) return "not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString();
}
