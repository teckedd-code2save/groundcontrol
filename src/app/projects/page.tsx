"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";
import { ContainerIcon, getContainerType, getContainerTypeLabel } from "@/components/TopoIcons";
import { linkSitesToContainers } from "@/lib/topology";
import { ActionConfirm } from "@/components/ActionConfirm";

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

export default function ProjectsPage() {
  const [data, setData] = useState<{
    directories: string[];
    caddySites: CaddySite[];
    services: Service[];
    projects: DbProject[];
  } | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [confirmDeploy, setConfirmDeploy] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState("/opt");

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
      })
      .catch(() => setLoading(false));
  }, []);

  async function triggerDeploy(slug: string) {
    setDeploying(slug);
    try {
      await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, branch: "main" }),
      });
    } finally {
      setDeploying(null);
      setConfirmDeploy(null);
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

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted mt-1">Everything running on your VPS</p>
        </div>
        <div className="animate-pulse space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-40 bg-card border border-border rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const dbProjects = data?.projects || [];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <p className="text-muted mt-1">Everything running on your VPS</p>
      </div>

      {dbProjects.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 text-muted text-sm">
          No projects found. Add a project in Settings to track deployments.
        </div>
      ) : (
        <div className="space-y-6">
          {dbProjects.map((project) => {
            const related = projectContainers.get(project.slug) || [];
            const running = related.filter((c) => c.state === "running").length;
            const stopped = related.filter((c) => c.state !== "running").length;
            const site = data?.caddySites.find((s) => project.domain && s.domain.toLowerCase() === project.domain.toLowerCase());

            return (
              <div
                key={project.slug}
                className="bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3">
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
                    onClick={() => setConfirmDeploy(project.slug)}
                    disabled={deploying === project.slug}
                    className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
                  >
                    {deploying === project.slug ? "Deploying..." : "Deploy"}
                  </button>
                </div>

                {/* Related Containers */}
                {related.length > 0 ? (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted">Related Services ({related.length})</h4>
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
                              <div className="text-[10px] text-muted font-mono truncate">{getContainerTypeLabel(ctype)} · {c.image}</div>
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

                {/* Caddy Config Preview */}
                {site && (
                  <div className="mt-3">
                    <div className="text-[10px] font-mono text-muted mb-1">Caddy Config</div>
                    <pre className="text-[10px] font-mono text-muted bg-background/50 p-2 rounded-lg overflow-auto max-h-24 scrollbar-thin">
                      <SensitiveField value={site.content} />
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Legacy sections */}
      {data && (
        <div className="mt-12 space-y-8">
          <section>
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Caddy Sites</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.caddySites.map((site) => (
                <div
                  key={site.domain}
                  className="bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-colors"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-medium text-accent">
                      <SensitiveField value={site.domain} />
                    </div>
                    <div className="text-xs text-muted font-mono">
                      <SensitiveField value={site.file} />
                    </div>
                  </div>
                  <pre className="mt-3 text-[10px] font-mono text-muted bg-background/50 p-3 rounded-lg overflow-auto max-h-32 scrollbar-thin">
                    <SensitiveField value={site.content} />
                  </pre>
                </div>
              ))}
              {data.caddySites.length === 0 && (
                <p className="text-muted text-sm">No Caddy sites found</p>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Systemd Services</h2>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted text-xs font-mono uppercase">
                    <th className="text-left p-4">Service</th>
                    <th className="text-left p-4">Load</th>
                    <th className="text-left p-4">Active</th>
                    <th className="text-left p-4">Sub</th>
                  </tr>
                </thead>
                <tbody>
                  {data.services.map((svc) => (
                    <tr
                      key={svc.name}
                      className="border-b border-border/50 hover:bg-background/50 transition-colors"
                    >
                      <td className="p-4 font-mono text-xs">{svc.name}</td>
                      <td className="p-4">
                        <span className={`text-xs ${svc.load === "loaded" ? "text-success" : "text-warning"}`}>
                          {svc.load}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`text-xs ${svc.active === "active" ? "text-success" : "text-muted"}`}>
                          {svc.active}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-muted">{svc.sub}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.services.length === 0 && (
                <p className="text-muted text-sm p-4 text-center">No services found</p>
              )}
            </div>
          </section>
        </div>
      )}

      {confirmDeploy && (
        <ActionConfirm
          open={!!confirmDeploy}
          action="deploy"
          targetName={confirmDeploy}
          targetType="Project"
          onConfirm={() => triggerDeploy(confirmDeploy)}
          onCancel={() => setConfirmDeploy(null)}
        />
      )}
    </div>
  );
}
