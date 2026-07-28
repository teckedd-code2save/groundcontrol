"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  };
  action?: { projectSlug: string; title: string; risk: string; rollback: string } | null;
  uncertainty?: string[];
};

export default function IntelligencePage() {
  const [graph, setGraph] = useState<GraphState | null>(null);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [investigation, setInvestigation] = useState<IncidentInvestigation | null>(null);
  const [investigating, setInvestigating] = useState(false);

  const paths = useMemo(() => graph?.paths || [], [graph?.paths]);
  const selectedPath = useMemo(
    () => paths.find((path) => path.domain === selectedDomain) || paths[0] || null,
    [paths, selectedDomain]
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
      setSelectedDomain((current) =>
        nextPaths.some((path) => path.domain === current) ? current : nextPaths[0]?.domain || ""
      );
      setInvestigation(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "GroundControl could not inspect this host.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const failed = paths.filter((path) => path.verification.status === "failed").length;
  const healthy = paths.filter((path) => path.verification.status === "passed").length;
  const hostEvidence = graph?.readiness.find((item) => item.id === "host");

  async function investigate(path: ServicePath) {
    setInvestigating(true);
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
      setInvestigation(data as IncidentInvestigation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "GroundControl could not resolve this incident.");
    } finally {
      setInvestigating(false);
    }
  }

  return (
    <div className="gc-page gc-page--wide">
      <PageHeader
        eyebrow="Intelligence"
        title="Fix what is broken"
        description="Choose a failing endpoint. GroundControl isolates the break, resolves the exact deployment, and refuses to act on an ambiguous target."
        actions={(
          <Button
            variant="primary"
            onClick={() => refresh(true)}
            disabled={loading}
            leadingIcon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
          >
            {loading ? "Checking…" : "Check all"}
          </Button>
        )}
      />

      {error && <Notice className="mt-5" tone="danger" title="Check failed">{error}</Notice>}

      {paths.length === 0 && !loading ? (
        <EmptyState
          className="mt-6"
          icon={<Activity size={22} />}
          title="No public endpoints found"
          description="Check the host to discover proxy routes and test them from the public internet."
          action={<Button variant="primary" onClick={() => refresh(true)} leadingIcon={<SearchCheck size={14} />}>Check host</Button>}
        />
      ) : paths.length > 0 ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border py-3 text-xs">
            <span><strong className="text-foreground">{paths.length}</strong> endpoints</span>
            <span className="text-error"><strong>{failed}</strong> failing</span>
            <span className="text-success"><strong>{healthy}</strong> healthy</span>
            <span className="text-muted">Checked {formatTime(graph?.reconciledAt)}</span>
            <span className="ml-auto">
              <StatusBadge tone={hostEvidence?.ready ? "success" : "warning"}>
                {hostEvidence?.ready ? "Host evidence ready" : "Host evidence unavailable"}
              </StatusBadge>
            </span>
          </div>

          <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="min-w-0 border border-border bg-card lg:sticky lg:top-20 lg:self-start">
              <div className="border-b border-border px-4 py-3">
                <p className="text-xs font-semibold">Endpoints</p>
                <p className="mt-1 text-[10px] text-muted">Failures first</p>
              </div>
              <div className="max-h-[620px] divide-y divide-border overflow-y-auto">
                {[...paths].sort(pathPriority).map((path) => (
                  <button
                    key={path.domain}
                    type="button"
                    onClick={() => setSelectedDomain(path.domain)}
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
}: {
  path: ServicePath;
  onFix: () => void;
  onRescan: () => void;
  loading: boolean;
  investigating: boolean;
  investigation: IncidentInvestigation | null;
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

          <div className="mt-4 flex flex-col gap-3 border border-accent/35 bg-accent/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Resolve this incident</p>
              <p className="mt-1 text-[11px] text-muted">
                GroundControl locks the investigation to this endpoint and refuses an ambiguous deployment target.
              </p>
            </div>
            <Button variant="primary" onClick={onFix} disabled={investigating} leadingIcon={<Wrench size={14} />}>
              {investigating ? "Investigating…" : "Investigate"}
            </Button>
          </div>

          {investigation && <IncidentResult investigation={investigation} />}

          <details className="mt-4 border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-medium">
              Evidence
              <ChevronDown size={14} className="text-muted" />
            </summary>
            <div className="divide-y divide-border border-t border-border">
              {(inspection?.evidence || []).map((item) => (
                <div key={item.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[120px_160px_minmax(0,1fr)] sm:items-start">
                  <span className={`font-mono text-[9px] uppercase ${item.status === "failed" ? "text-error" : item.status === "verified" ? "text-success" : "text-accent"}`}>
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

function IncidentResult({ investigation }: { investigation: IncidentInvestigation }) {
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
            <a href={`/deployments/${target.deploymentSlug}`} className="gc-button">Open deployment</a>
          </div>
          <p className="mt-3 break-all font-mono text-[10px] text-muted">{target.composePath || target.sourcePath || "Compose source not discovered"} · {target.composeServices.join(", ") || "No service resolved"} · {target.proxyRoute || "No route resolved"}</p>
          {investigation.action && <Notice className="mt-4" tone="warning" title={`Approval required · ${investigation.action.title}`}>Exact target: {investigation.action.projectSlug}. Risk: {investigation.action.risk}. Rollback: {investigation.action.rollback}.</Notice>}
        </div>
      )}
      {investigation.uncertainty && investigation.uncertainty.length > 0 && <div className="border-t border-border p-3 text-[10px] text-muted">Uncertainty: {investigation.uncertainty.join(" ")}</div>}
    </div>
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

function formatTime(value?: string) {
  if (!value) return "not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString();
}
