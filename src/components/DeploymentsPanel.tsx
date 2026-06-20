"use client";

import { useEffect, useState, useCallback } from "react";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";

interface DeploymentTarget {
  id: number;
  name: string;
  type: string;
  configJson: string;
}

interface DeploymentProject {
  id: number;
  slug: string;
  name: string;
}

interface Deployment {
  id: number;
  projectId: number;
  targetId: number;
  jobId: number | null;
  status: string;
  branch: string;
  commitSha: string | null;
  imageTag: string | null;
  publicUrl: string | null;
  previewUrl: string | null;
  output: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  project: DeploymentProject;
  target: DeploymentTarget;
}

function JobOutput({ jobId, baseOutput }: { jobId: number; baseOutput: string | null }) {
  const [output, setOutput] = useState(baseOutput || "");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    if (jobId) {
      source = new EventSource(`/api/jobs/${jobId}/stream`);
      source.addEventListener("log", (event) => {
        if (cancelled) return;
        try {
          const data = JSON.parse((event as MessageEvent).data);
          setOutput((prev) => prev + (data.delta || ""));
          if (data.status) setStatus(data.status);
        } catch {
          // ignore malformed events
        }
      });
      source.addEventListener("done", (event) => {
        if (cancelled) return;
        try {
          const data = JSON.parse((event as MessageEvent).data);
          if (data.status) setStatus(data.status);
        } catch {
          // ignore
        }
      });
      source.addEventListener("error", () => {
        source?.close();
      });
    }

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [jobId]);

  return (
    <div className="space-y-2">
      {status && (
        <div className="text-[10px] font-mono text-muted">
          job status: <span className="text-accent">{status}</span>
        </div>
      )}
      {output && (
        <pre className="text-[10px] font-mono text-foreground/80 bg-background border border-border rounded p-2 max-h-96 overflow-auto whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeJson(res: Response): Promise<{ ok: boolean; data: any; text: string }> {
  const text = await res.text();
  try {
    const data = text ? JSON.parse(text) : {};
    return { ok: res.ok, data, text };
  } catch {
    return { ok: res.ok, data: { error: text || "Invalid response" }, text };
  }
}

function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function statusColor(status: string): string {
  switch (status) {
    case "success":
      return "bg-success/10 text-success border-success/30";
    case "failed":
    case "rolled_back":
      return "bg-error/10 text-error border-error/30";
    case "running":
    case "building":
    case "deploying":
      return "bg-accent/10 text-accent border-accent/30";
    default:
      return "bg-warning/10 text-warning border-warning/30";
  }
}

function isRunningStatus(status: string): boolean {
  return status === "running" || status === "building" || status === "deploying" || status === "pending";
}

function ProviderIcon({ type }: { type: string }) {
  if (type === "cloudrun") {
    return (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 4a5 5 0 0 0-5 5c0 1.1.35 2.12.95 2.95A4.97 4.97 0 0 0 7 16a5 5 0 0 0 5 5h5a5 5 0 0 0 1.95-9.6A5 5 0 0 0 12 4z" />
      </svg>
    );
  }
  if (type === "k3s") {
    return (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    );
  }
  if (type === "compose") {
    return (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    );
  }
  if (type === "static") {
    return (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    );
  }
  return null;
}

function getK3sNamespace(target: DeploymentTarget, projectSlug: string): string {
  if (target.type !== "k3s") return "";
  try {
    const cfg = JSON.parse(target.configJson || "{}");
    return String(cfg.namespace || "gc-{slug}").replace("{slug}", projectSlug);
  } catch {
    return `gc-${projectSlug}`;
  }
}

function getK3sIngressClass(target: DeploymentTarget): string | null {
  if (target.type !== "k3s") return null;
  try {
    const cfg = JSON.parse(target.configJson || "{}");
    return cfg.ingressClass || "traefik";
  } catch {
    return "traefik";
  }
}

export function DeploymentsPanel() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [expandedOutput, setExpandedOutput] = useState<number | null>(null);

  const updateDeployments = useCallback((items: Deployment[]) => {
    setDeployments(items);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/deployments")
      .then((r) => safeJson(r))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setError(data.error || "Failed to load deployments");
        } else {
          setDeployments(Array.isArray(data) ? data : []);
          setError("");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load deployments");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const hasRunning = deployments.some((d) => isRunningStatus(d.status));
    if (!hasRunning) return;

    const interval = setInterval(() => {
      fetch("/api/deployments")
        .then((r) => safeJson(r))
        .then(({ ok, data }) => {
          if (ok) updateDeployments(Array.isArray(data) ? data : []);
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, [deployments, updateDeployments]);

  async function rollback(id: number) {
    setRollingBack(id);
    try {
      const res = await fetch(`/api/deployments/${id}/rollback`, { method: "POST" });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setError(`Rollback failed: ${data.error || "Unknown error"}`);
      } else {
        setError("");
        const refreshed = await fetch("/api/deployments").then((r) => safeJson(r));
        if (refreshed.ok) {
          setDeployments(Array.isArray(refreshed.data) ? refreshed.data : []);
        }
      }
    } catch (err) {
      setError(`Rollback failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRollingBack(null);
    }
  }

  return (
    <div className="space-y-6 relative">
      <LoaderOverlay3D open={loading} variant="generic" title="Loading deployments..." />

      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:text-foreground">✕</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted/70 leading-relaxed">
          Recent deployments across all projects and targets.
        </p>
        <button
          onClick={() => {
            fetch("/api/deployments")
              .then((r) => safeJson(r))
              .then(({ ok, data }) => {
                if (ok) updateDeployments(Array.isArray(data) ? data : []);
              })
              .catch(() => {});
          }}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {deployments.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 text-muted text-sm">
          No deployments yet. Use the Projects tab to deploy a project.
        </div>
      ) : (
        <div className="space-y-3">
          {deployments.map((d) => (
            <div
              key={d.id}
              className="bg-card border border-border rounded-xl p-4 hover:border-border-hover transition-colors"
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusColor(d.status)}`}>
                      {d.status}
                    </span>
                    <span className="font-medium text-sm">{d.project.name}</span>
                    <span className="text-[10px] font-mono text-muted bg-border/40 px-1.5 py-0.5 rounded">
                      {d.project.slug}
                    </span>
                  </div>

                  <div className="text-xs text-muted font-mono mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>target: {d.target.name}</span>
                    <span className="inline-flex items-center gap-1">
                      type: {d.target.type}
                      <ProviderIcon type={d.target.type} />
                    </span>
                    <span>branch: {d.branch}</span>
                    {d.commitSha && <span>commit: {d.commitSha.slice(0, 8)}</span>}
                    {d.durationMs !== null && d.durationMs !== undefined && <span>duration: {formatDuration(d.durationMs)}</span>}
                    <span>{formatDate(d.createdAt)}</span>
                  </div>

                  {d.target.type === "k3s" && (
                    <div className="text-[10px] text-muted font-mono mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>namespace: {getK3sNamespace(d.target, d.project.slug)}</span>
                      <span>ingress class: {getK3sIngressClass(d.target)}</span>
                    </div>
                  )}

                  {d.target.type === "cloudrun" && d.publicUrl && (
                    <div className="text-[10px] text-muted font-mono mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Cloud Run service URL: {d.publicUrl}</span>
                    </div>
                  )}

                  {(d.publicUrl || d.previewUrl) && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {d.publicUrl && (
                        <a
                          href={d.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border bg-success/10 text-success border-success/30 hover:bg-success/20 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          {d.publicUrl}
                        </a>
                      )}
                      {d.previewUrl && (
                        <a
                          href={d.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border bg-accent/10 text-accent border-accent/30 hover:bg-accent/20 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          preview
                        </a>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {d.target.type === "k3s" && (
                    <a
                      href={`/topology?k8sNamespace=${encodeURIComponent(getK3sNamespace(d.target, d.project.slug))}`}
                      className="px-3 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors"
                    >
                      View in k8s
                    </a>
                  )}
                  {(d.output || d.error || d.jobId) && (
                    <button
                      onClick={() => setExpandedOutput(expandedOutput === d.id ? null : d.id)}
                      className="px-3 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
                    >
                      {expandedOutput === d.id ? "Hide output" : "View output"}
                    </button>
                  )}
                  <button
                    onClick={() => rollback(d.id)}
                    disabled={rollingBack === d.id || isRunningStatus(d.status)}
                    className="px-3 py-2 text-xs font-mono bg-warning/10 border border-warning/30 text-warning rounded-lg hover:bg-warning/20 transition-colors disabled:opacity-50"
                  >
                    {rollingBack === d.id ? "Rolling back..." : "Rollback"}
                  </button>
                </div>
              </div>

              {expandedOutput === d.id && (d.output || d.error || d.jobId) && (
                <div className="mt-3 space-y-2">
                  {d.error && (
                    <div className="text-[10px] font-mono text-error bg-error/5 border border-error/20 rounded p-2 whitespace-pre-wrap">
                      {d.error}
                    </div>
                  )}
                  {d.jobId && isRunningStatus(d.status) ? (
                    <JobOutput jobId={d.jobId} baseOutput={d.output} />
                  ) : d.output ? (
                    <pre className="text-[10px] font-mono text-foreground/80 bg-background border border-border rounded p-2 max-h-60 overflow-auto whitespace-pre-wrap">
                      {d.output}
                    </pre>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
