"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";
import { ActionConfirm, ActionType } from "@/components/ActionConfirm";
import { ContainerIcon, getContainerType, getContainerTypeLabel, HostIcon, SiteIcon, CaddyIcon, NginxIcon } from "@/components/TopoIcons";
import { linkSitesToContainers } from "@/lib/topology";

interface XRayTarget {
  type: "container" | "site" | "host" | "caddy" | "nginx" | "system";
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
  const [allContainers, setAllContainers] = useState<any[]>([]);

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
        const [containersRes, logsRes, projectsRes] = await Promise.all([
          fetch("/api/containers"),
          fetch(`/api/containers/logs?name=${target.id}&tail=50`),
          fetch("/api/projects"),
        ]);
        const containers = await containersRes.json();
        const container = containers.find((c: any) => c.name === target.id);
        const logsData = await logsRes.json();
        const projects = await projectsRes.json();
        const sites = (projects.caddySites || []).map((s: any) => s.domain);
        setDetail({ ...container, _sites: sites });
        setLogs(logsData.logs || "No logs");
      } else if (target.type === "site") {
        const [containersRes, mapsRes, projectsRes] = await Promise.all([
          fetch("/api/containers"),
          fetch("/api/site-maps"),
          fetch("/api/projects"),
        ]);
        const containers = await containersRes.json();
        const siteMaps = await mapsRes.json();
        const projects = await projectsRes.json();
        const site = target.data;
        const dbProjects = projects.projects || [];

        const { siteGroups } = linkSitesToContainers(
          [site],
          containers,
          siteMaps,
          dbProjects
        );
        const group = siteGroups[0];

        setAllContainers(containers);
        setDetail({ ...site, relatedContainers: group?.containers || [], siteMaps });
      } else if (target.type === "host") {
        const res = await fetch("/api/vps/stats");
        setDetail(await res.json());
      } else if (target.type === "caddy" || target.type === "nginx") {
        const res = await fetch("/api/proxy");
        setDetail(await res.json());
      } else if (target.type === "system") {
        const [containersRes, mapsRes, projectsRes] = await Promise.all([
          fetch("/api/containers"),
          fetch("/api/site-maps"),
          fetch("/api/projects"),
        ]);
        const containers = await containersRes.json();
        const siteMaps = await mapsRes.json();
        const projects = await projectsRes.json();
        const dbProjects = projects.projects || [];
        const allSites = (projects.caddySites || []).map((s: any) => ({
          domain: s.domain,
          root: s.root,
          proxy: s.proxy,
        }));
        const { unmapped } = linkSitesToContainers(allSites, containers, siteMaps, dbProjects);
        const sites = allSites.map((s: any) => s.domain);
        setAllContainers(containers);
        setDetail({ unmapped, siteMaps, sites });
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
      } else if (action === "reload-caddy" || action === "reload-nginx") {
        const res = await fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reload", server: action === "reload-caddy" ? "caddy" : "nginx" }),
        });
        const data = await res.json();
        setLogs(data.output || data.error || `${action} completed`);
      } else if (action === "test-caddy" || action === "test-nginx") {
        const res = await fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test", server: action === "test-caddy" ? "caddy" : "nginx" }),
        });
        const data = await res.json();
        setLogs(data.output || data.error || `${action} completed`);
      } else if (action === "logs-caddy" || action === "logs-nginx") {
        const res = await fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "logs", server: action === "logs-caddy" ? "caddy" : "nginx" }),
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

  async function linkContainer(containerName: string) {
    if (!target || target.type !== "site") return;
    try {
      await fetch("/api/site-maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteDomain: target.name, containerName }),
      });
      await loadDetail();
    } catch (err) {
      console.error(err);
    }
  }

  async function linkContainerToSite(containerName: string, siteDomain: string) {
    try {
      await fetch("/api/site-maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteDomain, containerName }),
      });
      await loadDetail();
    } catch (err) {
      console.error(err);
    }
  }

  async function unlinkContainer(mapId: number) {
    try {
      await fetch(`/api/site-maps?id=${mapId}`, { method: "DELETE" });
      await loadDetail();
    } catch (err) {
      console.error(err);
    }
  }

  function getWhatsWrong() {
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

    if (target?.type === "system") {
      if (detail.unmapped?.length > 0) issues.push(`${detail.unmapped.length} container${detail.unmapped.length > 1 ? "s" : ""} not assigned to any site`);
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

    if (target?.type === "nginx") {
      if (!detail.nginx?.active) issues.push("Nginx is not running");
      if (detail.nginx?.version?.includes("not installed")) issues.push("Nginx binary not found on VPS");
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
                : (target.type === "caddy" || target.type === "nginx") && issues.length > 0
                ? "border-warning/30 text-warning"
                : target.type === "system" && issues.length > 0
                ? "border-warning/30 text-warning"
                : "border-accent/30 text-accent"
            }`}
          >
            {target.type === "host" && <HostIcon className="w-4 h-4" />}
            {target.type === "site" && <SiteIcon className="w-4 h-4" />}
            {target.type === "caddy" && <CaddyIcon className="w-4 h-4" />}
            {target.type === "nginx" && <NginxIcon className="w-4 h-4" />}
            {target.type === "system" && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            )}
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

                {/* Assign to Site */}
                {detail._sites && detail._sites.length > 0 && (
                  <div className="bg-background/30 rounded-lg p-3">
                    <label className="block text-[10px] font-mono text-muted mb-1.5">Assign to Site</label>
                    <div className="flex gap-2">
                      <select
                        className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent"
                        onChange={(e) => {
                          if (e.target.value) {
                            linkContainerToSite(target.id, e.target.value);
                            e.target.value = "";
                          }
                        }}
                        defaultValue=""
                      >
                        <option value="">Select a site...</option>
                        {detail._sites.map((domain: string) => (
                          <option key={domain} value={domain}>{domain}</option>
                        ))}
                      </select>
                    </div>
                    <p className="text-[10px] text-muted mt-1.5">Assignments persist until manually changed.</p>
                  </div>
                )}

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
                    <span className="font-mono text-xs text-foreground/80">{detail.domain}</span>
                  </div>
                  {detail.root && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Root</span>
                      <span className="font-mono text-xs text-foreground/80">{detail.root}</span>
                    </div>
                  )}
                  {detail.proxy && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Proxy</span>
                      <span className="font-mono text-xs text-foreground/80">{detail.proxy}</span>
                    </div>
                  )}
                </div>

                {/* Related Containers */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-mono text-muted">Related Containers ({detail.relatedContainers?.length || 0})</h4>
                  </div>
                  {detail.relatedContainers && detail.relatedContainers.length > 0 ? (
                    <div className="space-y-2">
                      {detail.relatedContainers.map((c: any) => {
                        const ctype = getContainerType(c.name, c.image);
                        const isManual = detail.siteMaps?.some((m: any) => m.siteDomain === detail.domain && m.containerName === c.name);
                        return (
                          <div key={c.name} className="bg-background/50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <ContainerIcon className="w-4 h-4" type={ctype} />
                                <span className="text-xs font-mono font-medium">{c.name}</span>
                                <span className="text-[10px] text-muted bg-border/50 px-1.5 py-0.5 rounded">{getContainerTypeLabel(ctype)}</span>
                                {c.composeProject && (
                                  <span className="text-[10px] text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded">{c.composeProject}:{c.composeService}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {isManual && (
                                  <button
                                    onClick={() => {
                                      const map = detail.siteMaps.find((m: any) => m.siteDomain === detail.domain && m.containerName === c.name);
                                      if (map) unlinkContainer(map.id);
                                    }}
                                    className="text-[10px] text-muted hover:text-error transition-colors"
                                  >
                                    Unlink
                                  </button>
                                )}
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
                  ) : (
                    <div className="text-xs text-muted bg-background/30 rounded-lg p-3">
                      No containers auto-detected for this site.
                      <br />
                      <span className="text-[10px]">Try linking containers manually below, or ensure Docker Compose project names match the domain.</span>
                    </div>
                  )}

                  {/* Manual Link */}
                  {allContainers.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      <select
                        className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent"
                        onChange={(e) => {
                          if (e.target.value) {
                            linkContainer(e.target.value);
                            e.target.value = "";
                          }
                        }}
                        defaultValue=""
                      >
                        <option value="">Link a container...</option>
                        {allContainers
                          .filter((c: any) => !detail.relatedContainers?.some((r: any) => r.name === c.name))
                          .map((c: any) => (
                            <option key={c.name} value={c.name}>
                              {c.name} {c.composeProject ? `(${c.composeProject})` : ""}
                            </option>
                          ))}
                      </select>
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
                    disabled={actionLoading === "reload-caddy"}
                    className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "reload-caddy" ? "..." : "Reload"}
                  </button>
                  <button
                    onClick={() => handleAction("test-caddy")}
                    disabled={actionLoading === "test-caddy"}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "test-caddy" ? "..." : "Test Config"}
                  </button>
                  <button
                    onClick={() => handleAction("logs-caddy")}
                    disabled={actionLoading === "logs-caddy"}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "logs-caddy" ? "..." : "View Logs"}
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

            {/* Nginx Specific */}
            {target.type === "nginx" && detail && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">Status</div>
                    <div className={`text-sm font-mono font-medium ${detail.nginx?.active ? "text-success" : "text-error"}`}>
                      {detail.nginx?.active ? "Active" : "Inactive"}
                    </div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-muted mb-1">Version</div>
                    <div className="text-sm font-mono font-medium truncate">{detail.nginx?.version || "—"}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setPendingAction({ action: "reload-nginx", name: "Nginx" })}
                    disabled={actionLoading === "reload-nginx"}
                    className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "reload-nginx" ? "..." : "Reload"}
                  </button>
                  <button
                    onClick={() => handleAction("test-nginx")}
                    disabled={actionLoading === "test-nginx"}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "test-nginx" ? "..." : "Test Config"}
                  </button>
                  <button
                    onClick={() => handleAction("logs-nginx")}
                    disabled={actionLoading === "logs-nginx"}
                    className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "logs-nginx" ? "..." : "View Logs"}
                  </button>
                </div>

                {detail.nginx?.sites && detail.nginx.sites.length > 0 && (
                  <div>
                    <h4 className="text-xs font-mono text-muted mb-2">Nginx Sites ({detail.nginx.sites.length})</h4>
                    <div className="space-y-2 max-h-48 overflow-auto scrollbar-thin">
                      {detail.nginx.sites.map((s: any, i: number) => (
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
                    <h4 className="text-xs font-mono text-muted mb-2">Nginx Logs</h4>
                    <pre className="bg-background/50 rounded-lg p-3 text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-64 overflow-auto scrollbar-thin">
                      {logs}
                    </pre>
                  </div>
                )}
              </>
            )}

            {/* System / Unmapped Containers */}
            {target.type === "system" && detail && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-mono text-muted">
                    Unmapped Containers ({detail.unmapped?.length || 0})
                  </h4>
                </div>
                {detail.unmapped && detail.unmapped.length > 0 ? (
                  <div className="space-y-2">
                    {detail.unmapped.map((c: any) => (
                      <div key={c.name} className="bg-background/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <ContainerIcon className="w-4 h-4" type={getContainerType(c.name, c.image)} />
                            <span className="text-xs font-mono font-medium">{c.name}</span>
                            {c.composeProject && (
                              <span className="text-[10px] text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded">{c.composeProject}</span>
                            )}
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
                        <div className="flex gap-2">
                          <select
                            className="flex-1 bg-background border border-border rounded-lg px-2 py-1 text-[10px] font-mono outline-none focus:border-accent"
                            onChange={(e) => {
                              if (e.target.value) {
                                linkContainerToSite(c.name, e.target.value);
                                e.target.value = "";
                              }
                            }}
                            defaultValue=""
                          >
                            <option value="">Assign to site...</option>
                            {detail.sites?.map((domain: string) => (
                              <option key={domain} value={domain}>{domain}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted bg-background/30 rounded-lg p-3">
                    All containers are mapped to sites.
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
