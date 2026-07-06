"use client";

import { useEffect, useState } from "react";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import {
  CaddyIcon,
  ContainerIcon,
  DatabaseIcon,
  NginxIcon,
  RedisIcon,
  ServiceIcon,
  getContainerType,
} from "@/components/TopoIcons";

interface Job {
  name: string;
  action: string;
  running: boolean;
  output: string;
  error: string;
  success?: boolean;
}

interface ToolStatus {
  installed: boolean;
  running?: boolean;
  version?: string;
}

interface ToolDef {
  key: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  kind: "host" | "container";
  lifecycle: ("start" | "stop" | "restart" | "reload")[];
}

const TOOLS: ToolDef[] = [
  {
    key: "docker",
    label: "Docker",
    desc: "Docker CE + compose plugin",
    icon: <ContainerIcon type={getContainerType("docker", "")} className="w-4 h-4 text-muted" />,
    kind: "host",
    lifecycle: ["start", "stop", "restart"],
  },
  {
    key: "caddy",
    label: "Caddy",
    desc: "Caddy reverse proxy",
    icon: <CaddyIcon className="w-4 h-4 text-muted" />,
    kind: "host",
    lifecycle: ["start", "stop", "restart", "reload"],
  },
  {
    key: "nginx",
    label: "Nginx",
    desc: "Nginx reverse proxy",
    icon: <NginxIcon className="w-4 h-4 text-muted" />,
    kind: "host",
    lifecycle: ["start", "stop", "restart", "reload"],
  },
  {
    key: "node",
    label: "Node.js",
    desc: "Node.js 20 LTS + npm",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "host",
    lifecycle: [],
  },
  {
    key: "git",
    label: "Git",
    desc: "Git version control",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "host",
    lifecycle: [],
  },
  {
    key: "terraform",
    label: "Terraform",
    desc: "HashiCorp Terraform CLI",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "host",
    lifecycle: [],
  },
  {
    key: "cloudflared",
    label: "Cloudflared",
    desc: "Cloudflare tunnel daemon image",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "container",
    lifecycle: [],
  },
  {
    key: "postgres",
    label: "PostgreSQL",
    desc: "PostgreSQL 16 image",
    icon: <DatabaseIcon className="w-4 h-4 text-muted" />,
    kind: "container",
    lifecycle: [],
  },
  {
    key: "redis",
    label: "Redis",
    desc: "Redis 7 image",
    icon: <RedisIcon className="w-4 h-4 text-muted" />,
    kind: "container",
    lifecycle: [],
  },
  {
    key: "traefik",
    label: "Traefik",
    desc: "Traefik v3 image",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "container",
    lifecycle: [],
  },
  {
    key: "certbot",
    label: "Certbot",
    desc: "Certbot image",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "container",
    lifecycle: [],
  },
];

const K3S_TOOLS = [
  { key: "k3s", label: "k3s", lifecycle: ["start", "stop", "restart"] as ("start" | "stop" | "restart")[] },
  { key: "kubectl", label: "kubectl", lifecycle: [] as ("start" | "stop" | "restart")[] },
  { key: "helm", label: "Helm", lifecycle: [] as ("start" | "stop" | "restart")[] },
];

interface ConfirmState {
  open: boolean;
  tool: string;
  action: string;
  label: string;
}

export function BootstrapPanel() {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [status, setStatus] = useState<{
    inContainerLocalMode: boolean;
    hostPackagesAllowed: { ok: boolean; reason?: string };
    components: Record<string, ToolStatus>;
  } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false, tool: "", action: "", label: "" });

  const hostPackagesBlocked = status?.inContainerLocalMode && !status?.hostPackagesAllowed.ok;

  useEffect(() => {
    fetch("/api/bootstrap/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setStatus(data);
      })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  function refreshStatus() {
    fetch("/api/bootstrap/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStatus(s))
      .catch(() => {});
  }

  async function run(tool: string, action: string) {
    setJobs((prev) => ({
      ...prev,
      [tool]: { name: tool, action, running: true, output: "", error: "" },
    }));
    try {
      const res = await fetch("/api/bootstrap/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, action }),
      });
      const data = await res.json();
      setJobs((prev) => ({
        ...prev,
        [tool]: {
          name: tool,
          action,
          running: false,
          output: data.output || "",
          error: data.error || "",
          success: data.success,
        },
      }));
      refreshStatus();
    } catch (err) {
      setJobs((prev) => ({
        ...prev,
        [tool]: {
          name: tool,
          action,
          running: false,
          output: "",
          error: err instanceof Error ? err.message : "Network error",
          success: false,
        },
      }));
    }
  }

  function requestAction(tool: string, action: string, label: string, destructive: boolean) {
    if (destructive) {
      setConfirm({ open: true, tool, action, label });
      return;
    }
    run(tool, action);
  }

  function confirmAction() {
    if (!confirm.open) return;
    run(confirm.tool, confirm.action);
    setConfirm({ open: false, tool: "", action: "", label: "" });
  }

  const runningJob = Object.values(jobs).find((j) => j.running);

  function renderStatusBadge(toolKey: string) {
    const state = status?.components[toolKey];
    if (!state) return null;

    if (state.installed && state.running === true) {
      return (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
          running
        </span>
      );
    }
    if (state.installed && state.running === false) {
      return (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30">
          stopped
        </span>
      );
    }
    if (state.installed) {
      return (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">
          installed
        </span>
      );
    }
    return null;
  }

  function renderActionButtons(tool: ToolDef) {
    const state = status?.components[tool.key];
    const installed = state?.installed ?? false;
    const hostDisabled = hostPackagesBlocked && tool.kind === "host";
    const job = jobs[tool.key];

    const buttons: React.ReactNode[] = [];

    buttons.push(
      <button
        key={installed ? "reinstall" : "install"}
        onClick={() => run(tool.key, installed ? "reinstall" : "install")}
        disabled={job?.running || hostDisabled}
        className="px-2.5 py-1 text-[10px] font-mono bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20 transition-colors disabled:opacity-50"
      >
        {job?.running && job.action === (installed ? "reinstall" : "install") ? "…" : installed ? "Re-install" : "Install"}
      </button>
    );

    if (installed) {
      buttons.push(
        <button
          key="uninstall"
          onClick={() => requestAction(tool.key, "uninstall", tool.label, true)}
          disabled={job?.running || hostDisabled}
          className="px-2.5 py-1 text-[10px] font-mono bg-error/10 border border-error/30 text-error rounded hover:bg-error/20 transition-colors disabled:opacity-50"
        >
          {job?.running && job.action === "uninstall" ? "…" : "Uninstall"}
        </button>
      );

      tool.lifecycle.forEach((action) => {
        buttons.push(
          <button
            key={action}
            onClick={() => run(tool.key, action)}
            disabled={job?.running || hostDisabled}
            className="px-2.5 py-1 text-[10px] font-mono bg-border/50 border border-border text-foreground rounded hover:bg-border transition-colors disabled:opacity-50"
          >
            {job?.running && job.action === action ? "…" : action}
          </button>
        );
      });
    }

    return <div className="flex flex-wrap gap-2">{buttons}</div>;
  }

  function renderTool(tool: ToolDef) {
    const job = jobs[tool.key];
    const hostDisabled = hostPackagesBlocked && tool.kind === "host";

    return (
      <div
        key={tool.key}
        className={`rounded-xl bg-background/30 p-4 ${hostDisabled ? "opacity-70" : ""}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {tool.icon}
              <div className="font-medium text-sm">{tool.label}</div>
              {renderStatusBadge(tool.key)}
              {hostDisabled && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30">
                  disabled
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted mt-0.5">{tool.desc}</div>
          </div>
        </div>

        <div className="mt-3">{renderActionButtons(tool)}</div>

        {job && !job.running && (
          <div className="mt-3">
            {job.success === false && (
              <div className="text-xs font-mono text-error mb-1">{job.action} failed: {job.error}</div>
            )}
            {job.success === true && (
              <div className="text-xs font-mono text-success mb-1">{job.action} finished</div>
            )}
            {(job.output || job.error) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] font-mono text-muted">Output</summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-background p-2 text-[10px] font-mono whitespace-pre-wrap">
                  {job.output}
                  {job.error}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderK3sCard() {
    const hostDisabled = hostPackagesBlocked;
    return (
      <div className={`rounded-xl bg-background/30 p-4 ${hostDisabled ? "opacity-70" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ServiceIcon className="w-4 h-4 text-muted" />
              <div className="font-medium text-sm">Kubernetes stack</div>
            </div>
            <div className="text-[11px] text-muted mt-0.5">
              Lightweight Kubernetes: k3s server, kubectl CLI, and Helm package manager.
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {K3S_TOOLS.map((tool) => {
            const state = status?.components[tool.key];
            const installed = state?.installed ?? false;
            const job = jobs[tool.key];

            return (
              <div key={tool.key} className="rounded-lg bg-background/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">{tool.label}</span>
                  {renderStatusBadge(tool.key)}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => run(tool.key, installed ? "reinstall" : "install")}
                    disabled={job?.running || hostDisabled}
                    className="px-2 py-1 text-[10px] font-mono bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20 transition-colors disabled:opacity-50"
                  >
                    {job?.running && job.action === (installed ? "reinstall" : "install") ? "…" : installed ? "Re-install" : "Install"}
                  </button>
                  {installed && (
                    <button
                      onClick={() => requestAction(tool.key, "uninstall", tool.label, true)}
                      disabled={job?.running || hostDisabled}
                      className="px-2 py-1 text-[10px] font-mono bg-error/10 border border-error/30 text-error rounded hover:bg-error/20 transition-colors disabled:opacity-50"
                    >
                      {job?.running && job.action === "uninstall" ? "…" : "Uninstall"}
                    </button>
                  )}
                  {installed &&
                    tool.lifecycle.map((action) => (
                      <button
                        key={action}
                        onClick={() => run(tool.key, action)}
                        disabled={job?.running || hostDisabled}
                        className="px-2 py-1 text-[10px] font-mono bg-border/50 border border-border text-foreground rounded hover:bg-border transition-colors disabled:opacity-50"
                      >
                        {job?.running && job.action === action ? "…" : action}
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>

        {K3S_TOOLS.map((tool) => {
          const job = jobs[tool.key];
          if (!job || job.running) return null;
          return (
            <div key={`${tool.key}-out`} className="mt-3">
              {job.success === false && (
                <div className="text-xs font-mono text-error mb-1">{tool.label} {job.action} failed: {job.error}</div>
              )}
              {job.success === true && (
                <div className="text-xs font-mono text-success mb-1">{tool.label} {job.action} finished</div>
              )}
              {(job.output || job.error) && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] font-mono text-muted">Output</summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-background p-2 text-[10px] font-mono whitespace-pre-wrap">
                    {job.output}
                    {job.error}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <LoaderOverlay3D
        open={!!runningJob}
        variant={runningJob?.name === "docker" ? "container" : ["caddy", "nginx", "traefik"].includes(runningJob?.name || "") ? "proxy" : "generic"}
        title={runningJob ? `${runningJob.action}ing ${runningJob.name}...` : undefined}
      />

      {confirm.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card border border-error/30 rounded-xl p-5 max-w-md w-full shadow-xl">
            <h3 className="text-sm font-semibold text-error mb-2">Confirm {confirm.action}</h3>
            <p className="text-xs text-muted mb-4">
              This will {confirm.action} <strong>{confirm.label}</strong>. This action is destructive and may interrupt
              running services.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirm({ open: false, tool: "", action: "", label: "" })}
                className="px-3 py-1.5 text-xs font-mono rounded border border-border hover:bg-border/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAction}
                className="px-3 py-1.5 text-xs font-mono rounded bg-error/10 border border-error/30 text-error hover:bg-error/20 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl bg-card p-4 md:p-5">
        <div className="mb-5 flex flex-col gap-1">
          <h2 className="text-sm font-medium">Component lifecycle</h2>
          <p className="max-w-3xl text-[11px] text-muted/70 leading-relaxed">
            Install, start, stop, restart, and reload host tools or container images on the active VPS.
          </p>
        </div>

        {statusLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-card rounded-xl p-4 h-20 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {hostPackagesBlocked && (
              <div className="mb-6 p-3 bg-warning/10 border border-warning/30 rounded-lg text-warning text-xs font-mono">
                <strong>Host-package actions are disabled.</strong> GroundControl is running inside a Docker container
                and cannot reach the host OS. Use SSH mode or run GroundControl directly on the host to manage Docker,
                Caddy, Nginx, Node.js, Git, Terraform, k3s, kubectl, and Helm. Container-image actions still work.
              </div>
            )}
            {status?.inContainerLocalMode && !hostPackagesBlocked && (
              <div className="mb-6 p-3 bg-info/10 border border-info/30 rounded-lg text-info text-xs font-mono">
                <strong>Running inside Docker.</strong> Host-level actions will be applied to the host operating system
                via namespace access.
              </div>
            )}

            <div className="space-y-6">
              <section>
                <h3 className="text-xs font-mono text-muted mb-3">Host packages</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{TOOLS.filter((t) => t.kind === "host").map(renderTool)}</div>
              </section>

              <section>
                <h3 className="text-xs font-mono text-muted mb-3">Container images</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{TOOLS.filter((t) => t.kind === "container").map(renderTool)}</div>
              </section>

              <section>
                <h3 className="text-xs font-mono text-muted mb-3">Kubernetes</h3>
                <div className="grid grid-cols-1 gap-4">{renderK3sCard()}</div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
