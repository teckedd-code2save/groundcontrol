"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";
import { ActionConfirm, ActionType } from "@/components/ActionConfirm";
import { ContainerIcon, getContainerType, getContainerTypeLabel, HostIcon, SiteIcon, CaddyIcon } from "@/components/TopoIcons";

interface XRayTarget {
  type: "container" | "site" | "host" | "caddy";
  id: string;
  name: string;
  data?: any;
}

interface XRayProps {
  target: XRayTarget | null;
  onClose: () => void;
}

export default function XRayPanel({ target, onClose }: XRayProps) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [pendingAction, setPendingAction] = useState<{ action: ActionType; name: string } | null>(null);

  useEffect(() => {
    if (!target) {
      setDetail(null);
      setLogs("");
      return;
    }
    loadDetail();
  }, [target]);

  async function loadDetail() {
    if (!target) return;
    setLoading(true);
    try {
      if (target.type === "container") {
        const [containersRes, logsRes] = await Promise.all([
          fetch("/api/containers"),
          fetch(`/api/containers/logs?name=${target.id}&tail=50`),
        ]);
        const containers = await containersRes.json();
        const container = containers.find((c: any) => c.name === target.id);
        const logsData = await logsRes.json();
        setDetail(container || null);
        setLogs(logsData.logs || "No logs");
      } else if (target.type === "site") {
        const [containersRes] = await Promise.all([fetch("/api/containers")]);
        const containers = await containersRes.json();
        // Find containers related to this site
        const site = target.data;
        const domainSlug = site.domain.toLowerCase().replace(/[^a-z0-9]/g, "");
        const proxyBase = site.proxy?.replace(/:.*/, "").toLowerCase() || "";
        const related = containers.filter((c: any) => {
          const n = c.name.toLowerCase();
          return (proxyBase && n.includes(proxyBase)) || (domainSlug && (n.includes(domainSlug) || domainSlug.includes(n)));
        });
        setDetail({ ...site, relatedContainers: related });
      } else if (target.type === "host") {
        const res = await fetch("/api/vps/stats");
        setDetail(await res.json());
      } else if (target.type === "caddy") {
        const res = await fetch("/api/proxy");
        setDetail(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: string, name?: string) {
    setActionLoading(action);
    try {
      if (action === "restart" || action === "stop" || action === "start") {
        await fetch("/api/containers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, name }),
        });
      } else if (action === "remove" && name) {
        await fetch("/api/containers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove", name }),
        });
      } else if (action === "reload-caddy") {
        await fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reload", server: "caddy" }),
        });
      } else if (action === "test-caddy") {
        await fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test", server: "caddy" }),
        });
      } else if (action === "logs-caddy") {
        const res = await fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "logs", server: "caddy" }),
        });
        const data = await res.json();
        setLogs(data.output || data.error || "No logs");
      } else if (action === "logs" && name) {
        const res = await fetch(`/api/containers/logs?name=${name}&tail=200`);
        const data = await res.json();
        setLogs(data.logs || "No logs");
      } else if (action === "shell" && name) {
        window.open(`/terminal`, "_blank");
      } else if (action === "prune") {
        await fetch("/api/containers/prune", { method: "POST" });
      }
      await loadDetail();
    } finally {
      setActionLoading(null);
    }
  }

  function getWhatsWrong(): string[] {
    if (!detail) return [];
    const issues: string[] = [];

    if (target?.type === "container") {
      if (detail.state !== "running") issues.push(`Container is ${detail.state}`);
      if (detail.status?.includes("unhealthy")) issues.push("Health checks are failing");
      if (detail.status?.includes("Restarting")) issues.push("Container is in a restart loop");
      if (detail.status?.includes("OOMKilled")) issues.push("Container was killed by out-of-memory");
      const cpu = parseFloat(detail.stats?.cpu || "0");
      if (cpu > 90) issues.push(`CPU usage is critically high (${detail.stats.cpu})`);
      const memMatch = detail.stats?.mem?.match(/(\d+\.?\d*)/);
      if (memMatch && parseFloat(memMatch[1]) > 90) issues.push(`Memory usage is critically high (${detail.stats.mem})`);
    }

    if (target?.type === "site") {
      if (!detail.domain) issues.push("No domain configured");
      if (!detail.root && !detail.proxy) issues.push("No root or proxy target configured");
      if (detail.relatedContainers?.length === 0) issues.push("No containers mapped to this site");
    }

    if (target?.type === "host") {
      const memPct = parseFloat(detail.memory?.percent || "0");
      const diskPct = parseFloat(detail.disk?.percent || "0");
      if (memPct > 90) issues.push(`Memory usage is critically high (${memPct}%)`);
      else if (memPct > 80) issues.push(`Memory usage is elevated (${memPct}%)`);
      if (diskPct > 90) issues.push(`Disk usage is critically high (${diskPct}%)`);
      else if (diskPct > 80) issues.push(`Disk usage is elevated (${diskPct}%)`);
      const loadRatio = (detail.load?.[0] || 0) / (detail.cpuCount || 1);
      if (loadRatio > 2) issues.push(`Load average is critically high (${loadRatio.toFixed(2)}x CPU count)`);
    }

    if (target?.type === "caddy") {
      if (!detail.caddy?.active) issues.push("Caddy is not running");
      if (detail.caddy?.version?.includes("not installed")) issues.push("Caddy binary not found on VPS");
    }

    return issues;
  }

  if (!target) return null;

  const issues = getWhatsWrong();
  const open = !!target;

  return (
    <div
      className={`fixed inset-y-0 right-0 z-[60] w-full max-w-md bg-card border-l border-border shadow-2xl transform transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
              target.type === "container"
                ? detail?.state === "running"
                  ? detail?.status?.includes("unhealthy")
                    ? "border-warning/30 text-warning"
                    : "border-success/30 text-success"
                  : "border-error/30 text-error"
                : target.type === "host"
                ? issues.length > 0
                  ? "border-warning/30 text-warning"
                  : "border-success/30 text-success"
                : target.type === "site" && issues.length > 0
                ? "border-warning/30 text-warning"
                : target.type === "caddy" && issues.length > 0
                ? "border-warning/30 text-warning"
                : "border-accent/30 text-accent"
            }`}
          >
            {target.type === "host" && <HostIcon className="w-4 h-4" />}
            {target.type === "site" && <SiteIcon className="w-4 h-4" />}
            {target.type === "caddy" && <CaddyIcon className="w-4 h-4" />}
            {target.type === "container" && <ContainerIcon className="w-4 h-4" type={getContainerType(target.name)} />}
          </div>
          <div>
            <h3 className="font-medium text-sm">{target.name}</h3>
            <p className="text-[10px] text-muted font-mono uppercase">{target.type}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="overflow-auto h-[calc(100vh-4rem)] p-4 space-y-6">
        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-20 bg-border rounded-lg" />
            <div className="h-32 bg-border rounded-lg" />
          </div>
        ) : (
          <>
            {/* What's Wrong */}
            {issues.length > 0 && (
              <div className="bg-error/5 border border-error/20 rounded-lg p-3">
                <h4 className="text-xs font-mono text-error mb-2">Issues Detected</h4>
                <ul className="space-y-1">
                  {issues.map((issue, i) => (
                    <li key={i} className="text-xs text-error/80 flex items-start gap-2">
                      <span>•</span> {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Container Specific */}
            {target.type === "container" && detail && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">CPU</div>
                    <div className="text-sm font-mono font-medium">{detail.stats?.cpu || "—"}</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">Memory</div>
                    <div className="text-sm font-mono font-medium">{detail.stats?.mem || "—"}</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">PIDs</div>
                    <div className="text-sm font-mono font-medium">{detail.stats?.pids || "—"}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {detail.state === "running" ? (
                    <>
                      <button
                        onClick={() => setPendingAction({ action: "restart", name: target.id })}
                        disabled={actionLoading === "restart"}
                        className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === "restart" ? "..." : "Restart"}
                      </button>
                      <button
                        onClick={() => setPendingAction({ action: "stop", name: target.id })}
                        disabled={actionLoading === "stop"}
                        className="px-3 py-1.5 text-xs font-mono border border-error/30 text-error rounded hover:bg-error/10 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === "stop" ? "..." : "Stop"}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setPendingAction({ action: "start", name: target.id })}
                      disabled={actionLoading === "start"}
                      className="px-3 py-1.5 text-xs font-mono border border-success/30 text-success rounded hover:bg-success/10 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === "start" ? "..." : "Start"}
                    </button>
                  )}
                  <button
                    onClick={() => handleAction("logs", target.id)}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                  >
                    Refresh Logs
                  </button>
                  <button
                    onClick={() => handleAction("shell", target.id)}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                  >
                    Shell
                  </button>
                  <button
                    onClick={() => setPendingAction({ action: "remove", name: target.id })}
                    className="px-3 py-1.5 text-xs font-mono border border-muted/30 text-muted rounded hover:border-error hover:text-error transition-colors"
                  >
                    Remove
                  </button>
                </div>

                <div>
                  <h4 className="text-xs font-mono text-muted mb-2">Recent Logs</h4>
                  <pre className="bg-background/50 rounded-lg p-3 text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-64 overflow-auto scrollbar-thin">
                    {logs}
                  </pre>
                </div>
              </>
            )}

            {/* Site Specific */}
            {target.type === "site" && detail && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Domain</span>
                    <span className="font-mono text-xs">
                      <SensitiveField value={detail.domain} />
                    </span>
                  </div>
                  {detail.root && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Root</span>
                      <span className="font-mono text-xs">
                        <SensitiveField value={detail.root} />
                      </span>
                    </div>
                  )}
                  {detail.proxy && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Proxy</span>
                      <span className="font-mono text-xs">
                        <SensitiveField value={detail.proxy} />
                      </span>
                    </div>
                  )}
                </div>

                {/* Related Containers */}
                {detail.relatedContainers && detail.relatedContainers.length > 0 && (
                  <div>
                    <h4 className="text-xs font-mono text-muted mb-2">Related Containers</h4>
                    <div className="space-y-2">
                      {detail.relatedContainers.map((c: any) => {
                        const ctype = getContainerType(c.name, c.image);
                        return (
                          <div key={c.name} className="bg-background/50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <ContainerIcon className="w-4 h-4" type={ctype} />
                                <span className="text-xs font-mono font-medium">{c.name}</span>
                                <span className="text-[10px] text-muted bg-border/50 px-1.5 py-0.5 rounded">{getContainerTypeLabel(ctype)}</span>
                              </div>
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  c.state === "running"
                                    ? c.status?.includes("unhealthy")
                                      ? "bg-warning"
                                      : "bg-success"
                                    : "bg-error"
                                }`}
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-muted">
                              <span>CPU {c.stats?.cpu || "—"}</span>
                              <span>MEM {c.stats?.mem || "—"}</span>
                              <span>PIDs {c.stats?.pids || "—"}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setPendingAction({ action: "reload-caddy", name: "Caddy" })}
                    disabled={actionLoading === "reload-caddy"}
                    className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "reload-caddy" ? "..." : "Reload Caddy"}
                  </button>
                </div>

                <div>
                  <h4 className="text-xs font-mono text-muted mb-2">Config</h4>
                  <pre className="bg-background/50 rounded-lg p-3 text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-64 overflow-auto scrollbar-thin">
                    <SensitiveField value={detail.content} />
                  </pre>
                </div>
              </>
            )}

            {/* Caddy Specific */}
            {target.type === "caddy" && detail && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">Status</div>
                    <div className={`text-sm font-mono font-medium ${detail.caddy?.active ? "text-success" : "text-error"}`}>
                      {detail.caddy?.active ? "Active" : "Inactive"}
                    </div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">Version</div>
                    <div className="text-sm font-mono font-medium truncate">{detail.caddy?.version || "—"}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setPendingAction({ action: "reload-caddy", name: "Caddy" })}
                    className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors"
                  >
                    Reload
                  </button>
                  <button
                    onClick={() => handleAction("test-caddy")}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                  >
                    Test Config
                  </button>
                  <button
                    onClick={() => handleAction("logs-caddy")}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                  >
                    View Logs
                  </button>
                </div>

                {detail.caddy?.sites && detail.caddy.sites.length > 0 && (
                  <div>
                    <h4 className="text-xs font-mono text-muted mb-2">Caddy Sites ({detail.caddy.sites.length})</h4>
                    <div className="space-y-2 max-h-48 overflow-auto scrollbar-thin">
                      {detail.caddy.sites.map((s: any, i: number) => (
                        <div key={i} className="bg-background/50 rounded-lg p-3">
                          <div className="text-[10px] text-muted font-mono mb-1">{s.file}</div>
                          <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap">
                            <SensitiveField value={s.content} />
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {logs && (
                  <div>
                    <h4 className="text-xs font-mono text-muted mb-2">Caddy Logs</h4>
                    <pre className="bg-background/50 rounded-lg p-3 text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-64 overflow-auto scrollbar-thin">
                      {logs}
                    </pre>
                  </div>
                )}
              </>
            )}

            {/* Host Specific */}
            {target.type === "host" && detail && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">Memory</div>
                    <div className="text-sm font-mono">{detail.memory.percent}%</div>
                    <div className="text-[10px] text-muted">{detail.memory.used} / {detail.memory.total} MB</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">Disk</div>
                    <div className="text-sm font-mono">{detail.disk.percent}%</div>
                    <div className="text-[10px] text-muted">{detail.disk.used} / {detail.disk.total}</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">Load (1m)</div>
                    <div className="text-sm font-mono">{detail.load[0]?.toFixed(2)}</div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">Uptime</div>
                    <div className="text-sm font-mono">{Math.floor(detail.uptime / 86400)}d</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setPendingAction({ action: "prune", name: "Docker" })}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                  >
                    Prune Docker
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {pendingAction && (
        <ActionConfirm
          open={!!pendingAction}
          action={pendingAction.action}
          targetName={pendingAction.name}
          targetType={pendingAction.action === "prune" ? undefined : target?.type}
          onConfirm={() => {
            handleAction(pendingAction.action, pendingAction.name);
            setPendingAction(null);
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
