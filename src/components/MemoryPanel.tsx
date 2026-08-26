"use client";

import { useState, useEffect } from "react";
import { ActionConfirm, ActionType } from "@/components/ActionConfirm";

interface Process {
  pid: string;
  cpu: string;
  mem: string;
  rss: string;
  command: string;
}

interface Container {
  name: string;
  image: string;
  state: string;
  stats?: { cpu: string; mem: string };
}

interface CleanupPlan {
  images: {
    kept: { fullName: string; size?: string; reason: string }[];
    protected: { fullName: string; size?: string; reason: string; containers?: { name: string }[] }[];
    removable: { fullName: string; size?: string; reason: string }[];
  };
  containers: {
    protected: { name: string; reason: string }[];
    removable: { name: string; reason: string }[];
  };
  buildCache: {
    enabled: boolean;
    reclaimable?: string;
    reason: string;
  };
}

interface MemoryPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function MemoryPanel({ open, onClose }: MemoryPanelProps) {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ action: ActionType; name: string } | null>(null);
  const [result, setResult] = useState<string>("");
  const [cleanupPlan, setCleanupPlan] = useState<CleanupPlan | null>(null);

  useEffect(() => {
    if (open) loadData();
  }, [open]);

  async function loadData() {
    setLoading(true);
    setResult("");
    try {
      const [procRes, contRes] = await Promise.all([
        fetch("/api/processes"),
        fetch("/api/containers"),
      ]);
      const procs = await procRes.json();
      const conts = await contRes.json();
      setProcesses(Array.isArray(procs) ? procs : []);
      setContainers(Array.isArray(conts) ? conts : []);
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: string, name?: string) {
    setActionLoading(action);
    try {
      if (action === "prune") {
        const res = await fetch("/api/containers/prune", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setResult(`Prune failed: ${data.error || "Unknown error"}`);
        } else {
          setResult(data.output || "Prune complete");
        }
      } else if (action === "stop" && name) {
        await fetch("/api/containers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop", name }),
        });
        setResult(`Stopped ${name}`);
      } else if (action === "restart" && name) {
        await fetch("/api/containers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restart", name }),
        });
        setResult(`Restarted ${name}`);
      }
      await loadData();
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function openCleanupPlan() {
    setActionLoading("cleanup-preview");
    setResult("");
    try {
      const res = await fetch("/api/containers/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setResult(`Cleanup preview failed: ${data.error || "Unknown error"}`);
      } else {
        setCleanupPlan(data.plan);
      }
    } catch (err: any) {
      setResult(`Cleanup preview failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function runCleanup() {
    setActionLoading("cleanup");
    setResult("");
    try {
      const res = await fetch("/api/containers/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pruneBuildCache: true }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setResult(`Cleanup failed: ${data.error || "Unknown error"}`);
      } else {
        setResult(data.output || "Cleanup complete");
        await loadData();
      }
    } catch (err: any) {
      setResult(`Cleanup failed: ${err.message}`);
    } finally {
      setActionLoading(null);
      setCleanupPlan(null);
    }
  }

  // Sort processes by memory usage descending
  const topProcesses = [...processes]
    .filter((p) => parseFloat(p.mem) > 0)
    .sort((a, b) => parseFloat(b.mem) - parseFloat(a.mem))
    .slice(0, 15);

  // Sort containers by memory usage descending
  const containerMem = (c: Container) => {
    const match = c.stats?.mem?.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
  };
  const topContainers = [...containers]
    .filter((c) => c.state === "running")
    .sort((a, b) => containerMem(b) - containerMem(a))
    .slice(0, 10);

  const totalContainerMem = topContainers.reduce((sum, c) => sum + containerMem(c), 0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[10vh] bg-black/70 p-4">
      <div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-warning/10 border border-warning/30 flex items-center justify-center text-warning">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-sm">Memory breakdown</h3>
              <p className="text-[10px] text-muted font-mono">Top consumers and cleanup actions</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-6">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-20 bg-border rounded-lg" />
              <div className="h-32 bg-border rounded-lg" />
            </div>
          ) : (
            <>
              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={openCleanupPlan}
                  disabled={actionLoading === "cleanup-preview" || actionLoading === "cleanup"}
                  className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
                >
                  {actionLoading === "cleanup-preview" ? "..." : "Cleanup plan"}
                </button>
                <button
                  onClick={loadData}
                  className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                >
                  Refresh
                </button>
              </div>

              {result && (
                <div className="p-3 rounded-lg text-xs font-mono bg-accent/5 border border-accent/20 text-accent">
                  {result}
                </div>
              )}

              {/* Container Memory */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-muted">
                    Containers ({topContainers.length})
                  </h4>
                  <span className="text-[10px] text-muted font-mono">
                    Total: ~{totalContainerMem.toFixed(1)}%
                  </span>
                </div>
                {topContainers.length > 0 ? (
                  <div className="space-y-2">
                    {topContainers.map((c) => (
                      <div key={c.name} className="flex items-center justify-between bg-background/50 rounded-lg p-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-mono font-medium truncate">{c.name}</div>
                          <div className="text-[10px] text-muted truncate">{c.image}</div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-xs font-mono text-muted">{c.stats?.mem || "—"}</div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => setPendingAction({ action: "restart", name: c.name })}
                              disabled={actionLoading === "restart"}
                              className="text-[10px] px-2 py-1 border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                            >
                              Restart
                            </button>
                            <button
                              onClick={() => setPendingAction({ action: "stop", name: c.name })}
                              disabled={actionLoading === "stop"}
                              className="text-[10px] px-2 py-1 border border-error/30 text-error rounded hover:bg-error/10 transition-colors disabled:opacity-50"
                            >
                              Stop
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted bg-background/30 rounded-lg p-3">No running containers</div>
                )}
              </div>

              {/* Process Memory */}
              <div>
                <h4 className="text-xs font-mono uppercase tracking-wider text-muted mb-3">
                  Processes (top {topProcesses.length} by %MEM)
                </h4>
                {topProcesses.length > 0 ? (
                  <div className="space-y-1">
                    {topProcesses.map((p) => (
                      <div key={p.pid} className="flex items-center gap-3 bg-background/30 rounded-lg px-3 py-2">
                        <div className="w-12 text-[10px] font-mono text-muted shrink-0">PID {p.pid}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-mono truncate">{p.command}</div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="w-16 text-right">
                            <div className="h-1.5 bg-border rounded-full overflow-hidden">
                              <div
                                className="h-full bg-warning rounded-full"
                                style={{ width: `${Math.min(parseFloat(p.mem), 100)}%` }}
                              />
                            </div>
                          </div>
                          <div className="w-10 text-right text-xs font-mono text-muted">{p.mem}%</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted bg-background/30 rounded-lg p-3">No process data</div>
                )}
              </div>
            </>
          )}
        </div>

        {pendingAction && (
          <ActionConfirm
            open={!!pendingAction}
            action={pendingAction.action}
            targetName={pendingAction.name}
            onConfirm={() => {
              handleAction(pendingAction.action, pendingAction.name);
              setPendingAction(null);
            }}
            onCancel={() => setPendingAction(null)}
          />
        )}

        {cleanupPlan && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
              <div className="border-b border-border p-4">
                <h3 className="text-sm font-medium">Docker cleanup plan</h3>
                <p className="mt-1 text-xs text-muted">
                  GroundControl protects running images and stopped service images by default. Build cache can be cleaned safely, but future builds may take longer.
                </p>
              </div>
              <div className="max-h-[55vh] overflow-auto p-4 space-y-4">
                <CleanupSection title="Will remove" tone="warning" items={[
                  ...cleanupPlan.containers.removable.map((item) => ({ label: item.name, detail: item.reason })),
                  ...cleanupPlan.images.removable.map((item) => ({ label: item.fullName, detail: [item.size, item.reason].filter(Boolean).join(" · ") })),
                  { label: "Docker build cache", detail: cleanupPlan.buildCache.reclaimable || cleanupPlan.buildCache.reason },
                ]} />
                <CleanupSection title="Protected" tone="success" items={[
                  ...cleanupPlan.containers.protected.slice(0, 8).map((item) => ({ label: item.name, detail: item.reason })),
                  ...cleanupPlan.images.protected.slice(0, 8).map((item) => ({ label: item.fullName, detail: [item.size, item.reason].filter(Boolean).join(" · ") })),
                ]} />
                <CleanupSection title="Kept" tone="accent" items={cleanupPlan.images.kept.slice(0, 8).map((item) => ({
                  label: item.fullName,
                  detail: [item.size, item.reason].filter(Boolean).join(" · "),
                }))} />
              </div>
              <div className="flex justify-end gap-2 border-t border-border p-4">
                <button
                  onClick={() => setCleanupPlan(null)}
                  className="rounded border border-border px-4 py-2 text-xs font-mono transition-colors hover:border-accent hover:text-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={runCleanup}
                  disabled={actionLoading === "cleanup"}
                  className="rounded border border-warning/30 bg-warning/10 px-4 py-2 text-xs font-mono text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
                >
                  {actionLoading === "cleanup" ? "Cleaning..." : "Clean selected"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CleanupSection({
  title,
  items,
  tone,
}: {
  title: string;
  items: { label: string; detail?: string }[];
  tone: "warning" | "success" | "accent";
}) {
  const toneClass = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-accent";
  return (
    <div>
      <h4 className={`mb-2 text-xs font-mono ${toneClass}`}>{title}</h4>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={`${title}-${item.label}`} className="rounded-lg bg-background/40 px-3 py-2">
              <div className="truncate text-xs font-mono">{item.label}</div>
              {item.detail && <div className="mt-0.5 text-[10px] text-muted">{item.detail}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-background/30 p-3 text-xs text-muted">Nothing in this group.</div>
      )}
    </div>
  );
}
