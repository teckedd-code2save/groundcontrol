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
  running: boolean;
  output: string;
  error: string;
  success?: boolean;
}

interface ToolDef {
  key: string;
  label: string;
  desc: string;
  route: string;
  icon: React.ReactNode;
  kind: "host" | "container";
}

interface K3sToolDef {
  key: string;
  label: string;
  route: string;
}

const TOOLS: ToolDef[] = [
  {
    key: "docker",
    label: "Docker",
    desc: "Docker CE + compose plugin",
    route: "/api/bootstrap/docker",
    icon: <ContainerIcon type={getContainerType("docker", "")} className="w-4 h-4 text-muted" />,
    kind: "host",
  },
  {
    key: "caddy",
    label: "Caddy",
    desc: "Caddy reverse proxy",
    route: "/api/bootstrap/caddy",
    icon: <CaddyIcon className="w-4 h-4 text-muted" />,
    kind: "host",
  },
  {
    key: "nginx",
    label: "Nginx",
    desc: "Nginx reverse proxy",
    route: "/api/bootstrap/nginx",
    icon: <NginxIcon className="w-4 h-4 text-muted" />,
    kind: "host",
  },
  {
    key: "node",
    label: "Node.js",
    desc: "Node.js 20 LTS + npm",
    route: "/api/bootstrap/node",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "host",
  },
  {
    key: "git",
    label: "Git",
    desc: "Git version control",
    route: "/api/bootstrap/git",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "host",
  },
  {
    key: "cloudflared",
    label: "Cloudflared",
    desc: "Pull the cloudflared connector image",
    route: "/api/bootstrap/cloudflared",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "container",
  },
  {
    key: "terraform",
    label: "Terraform",
    desc: "HashiCorp Terraform CLI",
    route: "/api/bootstrap/terraform",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "host",
  },
  {
    key: "postgres",
    label: "PostgreSQL",
    desc: "Pull the PostgreSQL 16 image",
    route: "/api/bootstrap/postgres",
    icon: <DatabaseIcon className="w-4 h-4 text-muted" />,
    kind: "container",
  },
  {
    key: "redis",
    label: "Redis",
    desc: "Pull the Redis 7 image",
    route: "/api/bootstrap/redis",
    icon: <RedisIcon className="w-4 h-4 text-muted" />,
    kind: "container",
  },
  {
    key: "traefik",
    label: "Traefik",
    desc: "Pull the Traefik v3 image",
    route: "/api/bootstrap/traefik",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "container",
  },
  {
    key: "certbot",
    label: "Certbot",
    desc: "Pull the Certbot image",
    route: "/api/bootstrap/certbot",
    icon: <ServiceIcon className="w-4 h-4 text-muted" />,
    kind: "container",
  },
];

const K3S_TOOLS: K3sToolDef[] = [
  { key: "k3s", label: "k3s", route: "/api/bootstrap/k3s" },
  { key: "kubectl", label: "kubectl", route: "/api/bootstrap/kubectl" },
  { key: "helm", label: "Helm", route: "/api/bootstrap/helm" },
];

export function BootstrapPanel() {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [status, setStatus] = useState<{
    inContainerLocalMode: boolean;
    hostPackagesAllowed: { ok: boolean; reason?: string };
    installed: Record<string, boolean>;
  } | null>(null);

  const hostPackagesBlocked = status?.inContainerLocalMode && !status?.hostPackagesAllowed.ok;
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    fetch("/api/bootstrap/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setStatus(data);
      })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  async function run(key: string, route: string) {
    setJobs((prev) => ({
      ...prev,
      [key]: { name: key, running: true, output: "", error: "" },
    }));
    try {
      const res = await fetch(route, { method: "POST" });
      const data = await res.json();
      setJobs((prev) => ({
        ...prev,
        [key]: {
          name: key,
          running: false,
          output: data.output || "",
          error: data.error || "",
          success: data.success,
        },
      }));
      // Refresh installed status after a successful or failed attempt.
      if (data.success) {
        fetch("/api/bootstrap/status")
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => s && setStatus(s))
          .catch(() => {});
      }
    } catch (err) {
      setJobs((prev) => ({
        ...prev,
        [key]: {
          name: key,
          running: false,
          output: "",
          error: err instanceof Error ? err.message : "Network error",
          success: false,
        },
      }));
    }
  }

  const runningKey = Object.keys(jobs).find((k) => jobs[k].running);
  const runningTool = runningKey
    ? TOOLS.find((t) => t.key === runningKey) ?? K3S_TOOLS.find((t) => t.key === runningKey)
    : undefined;

  const hostTools = TOOLS.filter((t) => t.kind === "host");
  const containerTools = TOOLS.filter((t) => t.kind === "container");

  function renderK3sCard() {
    const hostDisabled = hostPackagesBlocked;
    return (
      <div className={`border border-border rounded-xl p-4 bg-background/30 ${hostDisabled ? "opacity-70" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ServiceIcon className="w-4 h-4 text-muted" />
              <div className="font-medium text-sm">Install k3s</div>
            </div>
            <div className="text-[11px] text-muted mt-0.5">
              Lightweight Kubernetes stack: k3s server, kubectl CLI, and Helm package manager.
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {K3S_TOOLS.map((tool) => {
            const job = jobs[tool.key];
            const installed = status?.installed[tool.key];
            return (
              <button
                key={tool.key}
                onClick={() => run(tool.key, tool.route)}
                disabled={job?.running || hostDisabled}
                className="px-3 py-1.5 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                {job?.running ? "Installing..." : installed ? `Re-install ${tool.label}` : `Install ${tool.label}`}
              </button>
            );
          })}
        </div>
        {K3S_TOOLS.map((tool) => {
          const job = jobs[tool.key];
          if (!job || job.running) return null;
          return (
            <div key={`${tool.key}-out`} className="mt-3">
              {job.success === false && (
                <div className="text-xs font-mono text-error mb-1">{tool.label} failed: {job.error}</div>
              )}
              {job.success === true && (
                <div className="text-xs font-mono text-success mb-1">{tool.label} install finished</div>
              )}
              {(job.output || job.error) && (
                <pre className="max-h-40 overflow-auto rounded-lg bg-background border border-border p-2 text-[10px] font-mono whitespace-pre-wrap">
                  {job.output}
                  {job.error}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderTool(tool: ToolDef) {
    const job = jobs[tool.key];
    const installed = status?.installed[tool.key];
    const hostDisabled = hostPackagesBlocked && tool.kind === "host";

    return (
      <div
        key={tool.key}
        className={`border border-border rounded-xl p-4 bg-background/30 ${hostDisabled ? "opacity-70" : ""}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {tool.icon}
              <div className="font-medium text-sm">{tool.label}</div>
              {installed && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                  installed
                </span>
              )}
              {hostDisabled && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30">
                  disabled
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted mt-0.5">{tool.desc}</div>
          </div>
          <button
            onClick={() => run(tool.key, tool.route)}
            disabled={job?.running || hostDisabled}
            className="px-3 py-1.5 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50 shrink-0"
          >
            {job?.running ? "Installing..." : installed ? "Re-install" : "Install"}
          </button>
        </div>
        {job && !job.running && (
          <div className="mt-3">
            {job.success === false && (
              <div className="text-xs font-mono text-error mb-1">Failed: {job.error}</div>
            )}
            {job.success === true && (
              <div className="text-xs font-mono text-success mb-1">Install finished</div>
            )}
            {(job.output || job.error) && (
              <pre className="max-h-40 overflow-auto rounded-lg bg-background border border-border p-2 text-[10px] font-mono whitespace-pre-wrap">
                {job.output}
                {job.error}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <LoaderOverlay3D
        open={!!runningKey}
        variant={runningKey === "docker" ? "container" : runningKey === "caddy" || runningKey === "nginx" || runningKey === "traefik" ? "proxy" : "generic"}
        title={runningTool ? `Installing ${runningTool.label}...` : undefined}
      />

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">One-Click Install</h2>
        <p className="text-[11px] text-muted/70 mb-6 leading-relaxed">
          Install common infrastructure on the active VPS. Host packages target the host OS. Container images are
          pulled to the host Docker daemon and work even when GroundControl itself runs inside Docker.
        </p>

        {statusLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 h-20 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {hostPackagesBlocked && (
              <div className="mb-6 p-3 bg-warning/10 border border-warning/30 rounded-lg text-warning text-xs font-mono">
                <strong>Host-package installs are disabled.</strong> GroundControl is running inside a Docker
                container and cannot reach the host OS. Use SSH mode or run GroundControl directly on the host to
                install Docker, Caddy, Nginx, Node.js, Git, Terraform, k3s, kubectl, and Helm. Container-image pulls
                still work.
              </div>
            )}
            {status?.inContainerLocalMode && !hostPackagesBlocked && (
              <div className="mb-6 p-3 bg-info/10 border border-info/30 rounded-lg text-info text-xs font-mono">
                <strong>Running inside Docker.</strong> Host-level installs will be applied to the host operating
                system via namespace access.
              </div>
            )}

            <div className="space-y-6">
              <section>
                <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Host Packages</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{hostTools.map(renderTool)}</div>
              </section>

              <section>
                <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Container Images</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{containerTools.map(renderTool)}</div>
              </section>

              <section>
                <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Kubernetes</h3>
                <div className="grid grid-cols-1 gap-4">{renderK3sCard()}</div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
