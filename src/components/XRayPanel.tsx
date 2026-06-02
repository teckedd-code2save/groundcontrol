"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";
import { ActionConfirm, ActionType } from "@/components/ActionConfirm";
import { ContainerIcon, getContainerType, getContainerTypeLabel, HostIcon, SiteIcon, ServiceIcon } from "@/components/TopoIcons";

interface XRayTarget {
  type: "container" | "site" | "service" | "host";
  id: string;
  name: string;
  data?: any;
}

interface XRayProps {
  target: XRayTarget | null;
  onClose: () => void;
}

interface ContainerDetail {
  name: string;
  image: string;
  status: string;
  state: string;
  stats?: { cpu: string; mem: string; net: string; block: string; pids: string };
  logs: string;
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
        setDetail(target.data || null);
      } else if (target.type === "service") {
        const containersRes = await fetch("/api/containers");
        const containers = await containersRes.json();
        const group = target.data?.group;
        const matchedContainers = group?.containers || [];
        const enriched = matchedContainers.map((c: any) => {
          const live = containers.find((lc: any) => lc.name === c.name);
          return { ...c, stats: live?.stats || null };
        });
        setDetail({
          ...target.data,
          containers: enriched,
        });
      } else if (target.type === "host") {
        const res = await fetch("/api/vps/stats");
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

    if (target?.type === "service" && detail.containers) {
      const stopped = detail.containers.filter((c: any) => c.state !== "running").length;
      const unhealthy = detail.containers.filter((c: any) => c.status?.includes("unhealthy")).length;
      if (stopped > 0) issues.push(`${stopped} of ${detail.containers.length} containers are stopped`);
      if (unhealthy > 0) issues.push(`${unhealthy} container${unhealthy > 1 ? "s" : ""} failing health checks`);
      if (detail.containers.length === 0) issues.push("No containers mapped to this service");
    }

    return issues;
  }

  function getInnerTopologyDescription(): string {
    if (target?.type !== "service" || !detail?.containers) return "";
    const containers: any[] = detail.containers;
    if (containers.length === 0) return "This service has no mapped containers. It may be a pure systemd service.";

    const types = containers.map((c) => getContainerType(c.name, c.image));
    const counts: Record<string, number> = {};
    types.forEach((t) => {
      counts[t] = (counts[t] || 0) + 1;
    });

    const parts: string[] = [];
    if (counts.frontend) parts.push(`${counts.frontend} frontend (${counts.frontend > 1 ? "load-balanced" : "serving UI"})`);
    if (counts.backend) parts.push(`${counts.backend} backend API${counts.backend > 1 ? "s" : ""}`);
    if (counts.database) parts.push(`${counts.database} data store${counts.database > 1 ? "s" : ""}`);
    if (counts.proxy) parts.push(`${counts.proxy} reverse proxy`);
    if (counts.default) parts.push(`${counts.default} supporting container${counts.default > 1 ? "s" : ""}`);

    return `This service comprises ${containers.length} container${containers.length > 1 ? "s" : ""}: ${parts.join(", ")}. ${containers.every((c: any) => c.state === "running") ? "All are operational." : "Some are not running."}`;
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
                : target.type === "service" && issues.length > 0
                ? "border-warning/30 text-warning"
                : "border-accent/30 text-accent"
            }`}
          >
            {target.type === "host" && <HostIcon className="w-4 h-4" />}
            {target.type === "site" && <SiteIcon className="w-4 h-4" />}
            {target.type === "service" && <ServiceIcon className="w-4 h-4" />}
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

            {/* Service Specific */}
            {target.type === "service" && detail && (
              <>
                {detail.service && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-background/50 rounded-lg p-3 text-center">
                      <div className="text-xs text-muted mb-1">Load</div>
                      <div className="text-sm font-mono font-medium">{detail.service.load}</div>
                    </div>
                    <div className="bg-background/50 rounded-lg p-3 text-center">
                      <div className="text-xs text-muted mb-1">Active</div>
                      <div className="text-sm font-mono font-medium">{detail.service.active}</div>
                    </div>
                    <div className="bg-background/50 rounded-lg p-3 text-center">
                      <div className="text-xs text-muted mb-1">Sub</div>
                      <div className="text-sm font-mono font-medium">{detail.service.sub}</div>
                    </div>
                  </div>
                )}

                {/* Inner Topology Description */}
                <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                  <h4 className="text-xs font-mono text-accent mb-1">Inner Topology</h4>
                  <p className="text-xs text-foreground/80 leading-relaxed">{getInnerTopologyDescription()}</p>
                </div>

                {/* Containers List */}
                {detail.containers && detail.containers.length > 0 && (
                  <div>
                    <h4 className="text-xs font-mono text-muted mb-2">Containers</h4>
                    <div className="space-y-2">
                      {detail.containers.map((c: any) => {
                        const ctype = getContainerType(c.name, c.image);
                        return (
                          <div key={c.name} className="bg-background/50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
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
                            <div className="mt-2 flex gap-2">
                              {c.state === "running" ? (
                                <>
                                  <button
                                    onClick={() => setPendingAction({ action: "restart", name: c.name })}
                                    className="text-[10px] font-mono border border-accent/30 text-accent rounded px-2 py-1 hover:bg-accent/10 transition-colors"
                                  >
                                    Restart
                                  </button>
                                  <button
                                    onClick={() => setPendingAction({ action: "stop", name: c.name })}
                                    className="text-[10px] font-mono border border-error/30 text-error rounded px-2 py-1 hover:bg-error/10 transition-colors"
                                  >
                                    Stop
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => setPendingAction({ action: "start", name: c.name })}
                                  className="text-[10px] font-mono border border-success/30 text-success rounded px-2 py-1 hover:bg-success/10 transition-colors"
                                >
                                  Start
                                </button>
                              )}
                              <button
                                onClick={() => handleAction("logs", c.name)}
                                className="text-[10px] font-mono border border-border rounded px-2 py-1 hover:border-accent hover:text-accent transition-colors"
                              >
                                Logs
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
                    <div className="text-[10px] text-muted">
                      {detail.memory.used} / {detail.memory.total} MB
                    </div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">Disk</div>
                    <div className="text-sm font-mono">{detail.disk.percent}%</div>
                    <div className="text-[10px] text-muted">
                      {detail.disk.used} / {detail.disk.total}
                    </div>
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
