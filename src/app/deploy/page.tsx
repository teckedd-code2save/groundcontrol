"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";
import { ContainerIcon, getContainerType, getContainerTypeLabel } from "@/components/TopoIcons";

interface DeployLog {
  id: number;
  projectSlug: string;
  status: string;
  branch: string;
  output: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface CaddySite {
  file: string;
  domain: string;
  root: string | null;
  proxy: string | null;
  content: string;
}

interface Service {
  name: string;
  load: string;
  active: string;
  sub: string;
}

interface DbProject {
  slug: string;
  name: string;
  domain?: string | null;
  path?: string | null;
  repoUrl?: string | null;
  category?: string;
  status?: string;
}

interface Container {
  name: string;
  image: string;
  status: string;
  state: string;
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
}

interface ComposeService {
  name: string;
  image?: string;
  build?: boolean;
}

interface ComposeInfo {
  services: ComposeService[];
  raw: string;
  error?: string;
}

export default function DeployPage() {
  const [logs, setLogs] = useState<DeployLog[]>([]);
  const [data, setData] = useState<{
    directories: string[];
    caddySites: CaddySite[];
    services: Service[];
    projects: DbProject[];
  } | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [composeData, setComposeData] = useState<Map<string, ComposeInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [confirmDeploySlug, setConfirmDeploySlug] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<DeployLog | null>(null);
  const [projectRoot, setProjectRoot] = useState("/opt");
  const [showCaddyForSlug, setShowCaddyForSlug] = useState<string | null>(null);

  async function fetchLogs() {
    try {
      const res = await fetch("/api/deploy");
      const data = await res.json();
      setLogs(data);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/containers").then((r) => r.json()),
      fetch("/api/system-config")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([projectsData, containersData, config]) => {
        setData(projectsData);
        setContainers(containersData);
        if (config?.projectRoot) setProjectRoot(config.projectRoot);
        setLoading(false);

        if (projectsData?.projects?.length > 0) {
          for (const p of projectsData.projects) {
            fetch(`/api/projects/compose?slug=${p.slug}`)
              .then((r) => r.json())
              .then((compose) => {
                setComposeData((prev) => {
                  const next = new Map(prev);
                  next.set(p.slug, compose);
                  return next;
                });
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => setLoading(false));

    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  async function triggerDeploy(slug: string) {
    setDeploying(slug);
    try {
      await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, branch: "main" }),
      });
      await fetchLogs();
    } finally {
      setDeploying(null);
      setConfirmDeploySlug(null);
    }
  }

  // Match containers to each project
  const projectContainers = new Map<string, Container[]>();
  if (data?.projects && containers.length > 0) {
    for (const project of data.projects) {
      const matched: Container[] = [];
      const projSlug = project.slug.toLowerCase();
      const projPath = (project.path || "").toLowerCase().replace(/\/$/, "");

      for (const c of containers) {
        const composeProj = (c.composeProject || "").toLowerCase();
        const cName = c.name.toLowerCase();
        const workingDir = (c.composeWorkingDir || "").toLowerCase().replace(/\/$/, "");
        const nameBase = cName.replace(/[-_]\d+$/, "");

        const matches =
          (composeProj && (composeProj === projSlug || composeProj.includes(projSlug) || projSlug.includes(composeProj))) ||
          (projPath && workingDir && (workingDir === projPath || workingDir.startsWith(projPath + "/"))) ||
          (projSlug.length > 2 &&
            (cName.startsWith(projSlug + "-") ||
              cName.startsWith(projSlug + "_") ||
              nameBase.startsWith(projSlug + "-") ||
              nameBase.startsWith(projSlug + "_")));

        if (matches) matched.push(c);
      }
      projectContainers.set(project.slug, matched);
    }
  }

  const dbProjects = data?.projects || [];

  // Build confirm modal preview data
  const confirmProject = confirmDeploySlug ? dbProjects.find((p) => p.slug === confirmDeploySlug) || null : null;
  const confirmRelated = confirmDeploySlug ? (projectContainers.get(confirmDeploySlug) || []) : [];
  const confirmCompose = confirmDeploySlug ? (composeData.get(confirmDeploySlug) || null) : null;

  const servicesToDeploy = confirmCompose?.services || [];
  const imagesToPull = servicesToDeploy.filter((s) => s.image);
  const servicesToRecreate = servicesToDeploy
    .map((svc) => {
      const existing = confirmRelated.find((c) => c.composeService === svc.name);
      return existing ? { service: svc, container: existing } : null;
    })
    .filter(Boolean) as { service: ComposeService; container: Container }[];
  const newServices = servicesToDeploy.filter((svc) => !confirmRelated.find((c) => c.composeService === svc.name));

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Deploy</h1>
          <p className="text-muted mt-1">Trigger safe deployments using docker compose on your VPS</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 h-40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Deploy</h1>
        <p className="text-muted mt-1">Trigger safe deployments using docker compose on your VPS</p>
      </div>

      {dbProjects.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 mb-8 text-muted text-sm">
          No projects found. Add a project in Settings to track deployments.
        </div>
      ) : (
        <div className="space-y-6 mb-12">
          {dbProjects.map((project) => {
            const related = projectContainers.get(project.slug) || [];
            const running = related.filter((c) => c.state === "running").length;
            const stopped = related.filter((c) => c.state !== "running").length;
            const site = data?.caddySites.find((s) => project.domain && s.domain.toLowerCase() === project.domain.toLowerCase());
            const compose = composeData.get(project.slug);

            return (
              <div
                key={project.slug}
                className="bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="font-medium text-lg">{project.name}</h3>
                      <span className="text-[10px] font-mono text-muted bg-border/50 px-1.5 py-0.5 rounded">
                        {project.category || "app"}
                      </span>
                      {related.length > 0 && (
                        <span className="text-[10px] font-mono text-success bg-success/10 px-1.5 py-0.5 rounded">
                          {running} up{stopped > 0 ? ` · ${stopped} down` : ""}
                        </span>
                      )}
                    </div>
                    {project.domain ? (
                      <p className="text-xs text-accent font-mono mt-1">{project.domain}</p>
                    ) : (
                      <p className="text-xs text-muted font-mono mt-1">No domain mapped</p>
                    )}
                    <p className="text-xs text-muted font-mono mt-0.5">
                      {projectRoot}/{project.slug}
                    </p>
                  </div>
                  <button
                    onClick={() => setConfirmDeploySlug(project.slug)}
                    disabled={deploying === project.slug}
                    className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
                  >
                    {deploying === project.slug ? "Deploying..." : "Deploy"}
                  </button>
                </div>

                {/* Deploy Preview — Compose Services */}
                {compose && compose.services && compose.services.length > 0 && (
                  <div className="mb-4 space-y-2">
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted">
                      Deploy Preview — {compose.services.length} service{compose.services.length > 1 ? "s" : ""}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {compose.services.map((svc) => {
                        const existing = related.find((c) => c.composeService === svc.name);
                        const isRunning = existing?.state === "running";
                        return (
                          <div
                            key={svc.name}
                            className={`flex items-center gap-2 p-2 rounded-lg border ${
                              isRunning ? "bg-background/50 border-border/50" : "bg-warning/5 border-warning/10"
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-mono truncate">{svc.name}</div>
                              <div className="text-[10px] text-muted font-mono truncate">
                                {svc.image || (svc.build ? "📦 build from Dockerfile" : "no image")}
                              </div>
                            </div>
                            {existing ? (
                              <div
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  isRunning ? "bg-success" : "bg-error"
                                }`}
                                title={isRunning ? "running" : "stopped"}
                              />
                            ) : (
                              <span className="text-[9px] font-mono text-accent shrink-0">new</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-[10px] text-muted font-mono">
                      Command: cd {projectRoot}/{project.slug} && docker compose pull && docker compose up -d --remove-orphans
                    </div>
                  </div>
                )}
                {compose && compose.error && (
                  <div className="mb-4 text-[10px] text-warning font-mono bg-warning/5 p-2 rounded-lg">
                    No compose file found at {projectRoot}/{project.slug}/docker-compose.yml
                  </div>
                )}

                {/* Related Containers */}
                {related.length > 0 ? (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted">Related Containers ({related.length})</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {related.map((c) => {
                        const ctype = getContainerType(c.name, c.image);
                        const isRunning = c.state === "running";
                        return (
                          <div
                            key={c.name}
                            className={`flex items-center gap-2 p-2 rounded-lg border ${
                              isRunning ? "bg-background/50 border-border/50" : "bg-error/5 border-error/10"
                            }`}
                          >
                            <ContainerIcon className="w-4 h-4" type={ctype} />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-mono truncate">{c.name}</div>
                              <div className="text-[10px] text-muted font-mono truncate">
                                {getContainerTypeLabel(ctype)} · {c.image}
                              </div>
                            </div>
                            <div
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isRunning
                                  ? c.status.includes("unhealthy")
                                    ? "bg-warning"
                                    : "bg-success"
                                  : "bg-error"
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted bg-background/30 rounded-lg p-3">
                    No containers matched to this project. Ensure Docker Compose project names match the project slug.
                  </div>
                )}

                {/* Minimal Caddy config link */}
                {site && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => setShowCaddyForSlug(showCaddyForSlug === project.slug ? null : project.slug)}
                      className="text-[10px] font-mono text-accent hover:underline"
                    >
                      {showCaddyForSlug === project.slug ? "Hide Caddy Config" : "View Caddy Config"}
                    </button>
                  </div>
                )}
                {showCaddyForSlug === project.slug && site && (
                  <pre className="mt-2 text-[10px] font-mono text-muted bg-background/50 p-2 rounded-lg overflow-auto max-h-24 scrollbar-thin">
                    <SensitiveField value={site.content} />
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Deployment History */}
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">
          Deployment History
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted text-xs font-mono uppercase">
                <th className="text-left p-4">Project</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Branch</th>
                <th className="text-left p-4">Duration</th>
                <th className="text-left p-4">Time</th>
                <th className="text-left p-4"></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-border/50 hover:bg-background/50 transition-colors"
                >
                  <td className="p-4 font-medium">{log.projectSlug}</td>
                  <td className="p-4">
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-mono ${
                        log.status === "success"
                          ? "bg-success/10 text-success"
                          : log.status === "failed"
                          ? "bg-error/10 text-error"
                          : log.status === "running"
                          ? "bg-accent/10 text-accent animate-pulse"
                          : "bg-warning/10 text-warning"
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="p-4 font-mono text-xs text-muted">{log.branch}</td>
                  <td className="p-4 font-mono text-xs text-muted">
                    {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="p-4 font-mono text-xs text-muted">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="text-xs font-mono text-accent hover:underline"
                    >
                      view
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && (
            <p className="text-muted text-sm p-4 text-center">No deployments yet</p>
          )}
        </div>
      </section>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
          <div className="bg-card border border-border rounded-xl w-full max-w-4xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-mono text-sm">
                Deploy: <span className="text-accent">{selectedLog.projectSlug}</span>
                <span
                  className={`ml-3 text-xs px-2 py-0.5 rounded-full ${
                    selectedLog.status === "success"
                      ? "bg-success/10 text-success"
                      : selectedLog.status === "failed"
                      ? "bg-error/10 text-error"
                      : "bg-accent/10 text-accent"
                  }`}
                >
                  {selectedLog.status}
                </span>
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-muted hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 font-mono text-xs space-y-4 scrollbar-thin">
              {selectedLog.output && (
                <div>
                  <div className="text-muted mb-1">stdout</div>
                  <pre className="bg-background/50 p-3 rounded-lg whitespace-pre-wrap">
                    {selectedLog.output}
                  </pre>
                </div>
              )}
              {selectedLog.error && (
                <div>
                  <div className="text-error mb-1">stderr</div>
                  <pre className="bg-error/5 p-3 rounded-lg whitespace-pre-wrap text-error/80">
                    {selectedLog.error}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Deploy Confirm Modal */}
      {confirmDeploySlug && confirmProject && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg p-6 max-h-[85vh] overflow-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center border border-accent/30 text-accent">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium">Deploy Project</h3>
                <p className="text-xs text-muted mt-0.5 font-mono">{confirmProject.slug}</p>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              {/* Services to deploy */}
              {servicesToDeploy.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">
                    Services to Deploy ({servicesToDeploy.length})
                  </h4>
                  <div className="space-y-1.5">
                    {servicesToDeploy.map((svc) => {
                      const existing = confirmRelated.find((c) => c.composeService === svc.name);
                      const isRunning = existing?.state === "running";
                      return (
                        <div key={svc.name} className="flex items-center justify-between text-xs font-mono bg-background/50 rounded-lg px-3 py-2">
                          <span>{svc.name}</span>
                          <div className="flex items-center gap-2">
                            {svc.image && <span className="text-[10px] text-muted truncate max-w-[200px]">{svc.image}</span>}
                            {existing ? (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isRunning ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>
                                {isRunning ? "running" : "stopped"}
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">new</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Images to pull */}
              {imagesToPull.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">
                    Images to Pull ({imagesToPull.length})
                  </h4>
                  <div className="space-y-1">
                    {imagesToPull.map((svc) => (
                      <div key={svc.name} className="text-xs font-mono text-accent bg-accent/5 rounded-lg px-3 py-1.5 truncate">
                        {svc.image}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Containers to recreate */}
              {servicesToRecreate.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">
                    Containers to Recreate ({servicesToRecreate.length})
                  </h4>
                  <div className="space-y-1">
                    {servicesToRecreate.map(({ service, container }) => (
                      <div key={service.name} className="flex items-center justify-between text-xs font-mono bg-warning/5 border border-warning/10 rounded-lg px-3 py-1.5">
                        <span>{container.name}</span>
                        <span className="text-[10px] text-warning">will be recreated</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New services */}
              {newServices.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">
                    New Services ({newServices.length})
                  </h4>
                  <div className="space-y-1">
                    {newServices.map((svc) => (
                      <div key={svc.name} className="text-xs font-mono bg-accent/5 border border-accent/10 rounded-lg px-3 py-1.5">
                        {svc.name}
                        {svc.image && <span className="text-[10px] text-muted ml-2">{svc.image}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border rounded-lg p-3 text-xs bg-accent/5 border-accent/20 text-accent/80">
                <span className="font-semibold">Command: </span>
                cd {projectRoot}/{confirmProject.slug} && docker compose pull && docker compose up -d --remove-orphans
              </div>

              <div className="border rounded-lg p-3 text-xs bg-warning/5 border-warning/20 text-warning/80">
                <span className="font-semibold">Warning: </span>
                This will pull the latest images and recreate containers. A brief downtime of a few seconds may occur while containers restart.
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeploySlug(null)}
                className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => triggerDeploy(confirmDeploySlug)}
                disabled={deploying === confirmDeploySlug}
                className="px-4 py-2 text-xs font-mono border border-accent/30 text-accent bg-accent/10 hover:bg-accent/20 rounded-lg transition-colors disabled:opacity-50"
              >
                {deploying === confirmDeploySlug ? "Deploying..." : "Confirm Deploy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
