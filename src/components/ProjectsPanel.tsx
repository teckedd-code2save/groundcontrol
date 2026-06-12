"use client";

import { useEffect, useState, useMemo } from "react";
import { ContainerIcon, getContainerType, getContainerTypeLabel } from "@/components/TopoIcons";
import { ActionConfirm } from "@/components/ActionConfirm";

interface CaddySite {
  file: string;
  domain: string;
  root: string | null;
  proxy: string | null;
  content: string;
}

interface Container {
  name: string;
  image: string;
  status: string;
  state: string;
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
  composeConfigFiles?: string;
  projectSlug?: string;
}

interface DockerImage {
  repository: string;
  tag: string;
  id: string;
  size: string;
  createdAt: string;
}

interface ComposeServiceInfo {
  name: string;
  image?: string;
  build?: boolean;
  ports?: string[];
}

interface ScannedProject {
  slug: string;
  dirName: string;
  name: string;
  path: string;
  composePath: string;
  parent: string | null;
  services: ComposeServiceInfo[];
  domain?: string;
  hasGit: boolean;
}

interface ProjectData {
  directories: string[];
  caddySites: CaddySite[];
  scannedProjects?: ScannedProject[];
  plainDirs?: string[];
  scanError?: string | null;
}

interface ComposeActionState {
  slug: string;
  type: "up" | "down" | "up-selected" | "down-selected";
}

interface ConfirmComposeState {
  slug: string;
  type: ComposeActionState["type"];
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

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function tokensMatch(a: string, b: string): boolean {
  const l = normalizeToken(a);
  const r = normalizeToken(b);
  return !!l && !!r && l === r;
}

function pathInside(workingDir: string, projectPath: string): boolean {
  const wd = (workingDir || "").toLowerCase().replace(/\/$/, "");
  const pp = (projectPath || "").toLowerCase().replace(/\/$/, "");
  if (!wd || !pp) return false;
  return wd === pp || wd.startsWith(pp + "/");
}

export function ProjectsPanel() {
  const [data, setData] = useState<ProjectData | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [confirmDeploy, setConfirmDeploy] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState("/opt");
  const [error, setError] = useState("");
  const [composeAction, setComposeAction] = useState<ComposeActionState | null>(null);
  const [composeOutput, setComposeOutput] = useState<{ slug: string; output: string; error?: string } | null>(null);
  const [selectedServices, setSelectedServices] = useState<Record<string, Set<string>>>({});
  const [confirmCompose, setConfirmCompose] = useState<ConfirmComposeState | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => safeJson(r)),
      fetch("/api/containers").then((r) => safeJson(r)),
      fetch("/api/docker-images").then((r) => safeJson(r)),
      fetch("/api/system-config")
        .then((r) => safeJson(r))
        .catch(() => ({ ok: true, data: null, text: "" })),
    ])
      .then(([projectsRes, containersRes, imagesRes, configRes]) => {
        setData(projectsRes.data);
        setContainers(Array.isArray(containersRes.data) ? containersRes.data : []);
        setImages(Array.isArray(imagesRes.data) ? imagesRes.data : []);
        if (configRes.data?.projectRoot) setProjectRoot(configRes.data.projectRoot);
        if (projectsRes.data?.scanError) setError(`Scan warning: ${projectsRes.data.scanError}`);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  async function triggerDeploy(slug: string) {
    setDeploying(slug);
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, branch: "main" }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) setError(`Deploy failed: ${data.error || "Unknown error"}`);
      else setError("");
    } catch (err) {
      setError(`Deploy failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeploying(null);
      setConfirmDeploy(null);
    }
  }

  async function startService(slug: string, service: string) {
    try {
      const res = await fetch("/api/compose-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, service }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || (!data.success && data.error)) {
        setError(`Start service failed: ${data.error || "Unknown error"}`);
      } else {
        setError("");
      }
    } catch (err) {
      setError(`Start service failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function runCompose(slug: string, type: "up" | "down", services?: string[]) {
    setComposeAction({ slug, type: services?.length ? `${type}-selected` : type });
    setComposeOutput(null);
    try {
      const endpoint = type === "up" ? "/api/projects/compose" : "/api/projects/compose-down";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, services }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setError(`${type === "up" ? "Up" : "Down"} failed: ${data.error || "Unknown error"}`);
        setComposeOutput({ slug, output: data.output || "", error: data.error });
      } else {
        setError("");
        setComposeOutput({ slug, output: data.output || `${type === "up" ? "Up" : "Down"} completed` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`${type === "up" ? "Up" : "Down"} failed: ${message}`);
      setComposeOutput({ slug, output: "", error: message });
    } finally {
      setComposeAction(null);
      setConfirmCompose(null);
    }
  }

  function isServiceSelected(slug: string, service: string): boolean {
    return selectedServices[slug]?.has(service) ?? false;
  }

  function toggleService(slug: string, service: string) {
    setSelectedServices((prev) => {
      const next = { ...prev };
      const set = new Set(next[slug] || []);
      if (set.has(service)) set.delete(service);
      else set.add(service);
      next[slug] = set;
      return next;
    });
  }

  function selectedServicesFor(slug: string): string[] {
    return Array.from(selectedServices[slug] || []);
  }

  const projects = useMemo(
    () =>
      (data?.scannedProjects || []).filter(
        (p) => p.dirName.toLowerCase() !== "groundcontrol"
      ),
    [data]
  );

  // Match live containers/images to each scanned project.
  const projectMeta = useMemo(() => {
    const result = new Map<string, { containers: Container[]; images: DockerImage[] }>();

    for (const project of projects) {
      const projDir = project.dirName.toLowerCase();
      const matched: Container[] = [];

      for (const c of containers) {
        const workingDir = c.composeWorkingDir || "";
        const configFiles = c.composeConfigFiles || "";
        const composeProj = (c.composeProject || "").toLowerCase();
        const cName = c.name.toLowerCase();
        const nameBase = cName.replace(/[-_]\d+$/, "");

        const isMatch =
          (workingDir && pathInside(workingDir, project.path)) ||
          (configFiles && pathInside(configFiles, project.path)) ||
          (composeProj && tokensMatch(composeProj, projDir)) ||
          (projDir.length > 2 &&
            (cName === projDir ||
              cName.startsWith(projDir + "-") ||
              cName.startsWith(projDir + "_") ||
              nameBase.startsWith(projDir + "-") ||
              nameBase.startsWith(projDir + "_")));

        if (isMatch) matched.push(c);
      }

      const composeImages = new Set(
        project.services.map((s) => s.image).filter(Boolean) as string[]
      );
      const matchedImages = images.filter((img) => {
        const full = img.tag && img.tag !== "<none>" ? `${img.repository}:${img.tag}` : img.repository;
        return composeImages.has(full) || composeImages.has(img.repository);
      });

      result.set(project.slug, { containers: matched, images: matchedImages });
    }
    return result;
  }, [projects, containers, images]);

  // Group projects by parent so nested projects render under their container dir.
  const grouped = useMemo(() => {
    const groups = new Map<string, ScannedProject[]>();
    for (const p of projects) {
      const key = p.parent || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [projects]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-48 bg-card border border-border rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:text-foreground">✕</button>
        </div>
      )}

      <p className="text-[11px] text-muted/70 leading-relaxed">
        Compose-bearing projects discovered under {projectRoot} — nested projects shown separately
      </p>

      {projects.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 text-muted text-sm">
          No compose-bearing projects found under {projectRoot}/. Place a{" "}
          <code>docker-compose.yml</code> in a project directory to see it here.
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([parent, groupProjects]) => (
            <div key={parent || "root"} className="space-y-4">
              {parent && (
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-mono uppercase tracking-wider text-muted">
                    {parent}/
                  </h2>
                  <span className="text-[10px] font-mono text-muted bg-border/40 px-1.5 py-0.5 rounded">
                    container of {groupProjects.length} project{groupProjects.length === 1 ? "" : "s"}
                  </span>
                </div>
              )}

              {groupProjects.map((project) => {
                const meta = projectMeta.get(project.slug) || { containers: [], images: [] };
                const running = meta.containers.filter((c) => c.state === "running").length;
                const stopped = meta.containers.filter((c) => c.state !== "running").length;
                const site =
                  (project.domain &&
                    data?.caddySites.find(
                      (s) => s.domain.toLowerCase() === project.domain!.toLowerCase()
                    )) ||
                  data?.caddySites.find((s) =>
                    s.domain.replace(/[^a-z0-9]/gi, "").toLowerCase().includes(
                      project.dirName.replace(/[^a-z0-9]/gi, "").toLowerCase()
                    )
                  );
                const selected = selectedServicesFor(project.slug);
                const isActing = composeAction?.slug === project.slug;

                return (
                  <div
                    key={project.slug}
                    className="bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-colors"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-medium text-lg">{project.name}</h3>
                          <span className="text-[10px] font-mono text-muted bg-border/50 px-1.5 py-0.5 rounded">
                            {project.slug}
                          </span>
                          {project.hasGit && (
                            <span className="text-[10px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                              git
                            </span>
                          )}
                          {meta.containers.length > 0 && (
                            <span className="text-[10px] font-mono text-success bg-success/10 px-1.5 py-0.5 rounded">
                              {running} up{stopped > 0 ? ` · ${stopped} down` : ""}
                            </span>
                          )}
                        </div>
                        {site ? (
                          <p className="text-xs text-accent font-mono mt-1">{site.domain}</p>
                        ) : project.domain ? (
                          <p className="text-xs text-accent font-mono mt-1">{project.domain}</p>
                        ) : (
                          <p className="text-xs text-muted font-mono mt-1">No domain mapped</p>
                        )}
                        <p className="text-xs text-muted font-mono mt-0.5 truncate">{project.path}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <button
                          onClick={() => setConfirmCompose({ slug: project.slug, type: "up" })}
                          disabled={!!composeAction}
                          className="px-3 py-2 text-xs font-mono bg-success/10 border border-success/30 text-success rounded-lg hover:bg-success/20 transition-colors disabled:opacity-50"
                        >
                          {isActing && composeAction?.type === "up" ? "Starting…" : "Up"}
                        </button>
                        <button
                          onClick={() => setConfirmCompose({ slug: project.slug, type: "down" })}
                          disabled={!!composeAction}
                          className="px-3 py-2 text-xs font-mono bg-warning/10 border border-warning/30 text-warning rounded-lg hover:bg-warning/20 transition-colors disabled:opacity-50"
                        >
                          {isActing && composeAction?.type === "down" ? "Stopping…" : "Down"}
                        </button>
                        <button
                          onClick={() => setConfirmDeploy(project.slug)}
                          disabled={deploying === project.slug}
                          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50 shrink-0"
                        >
                          {deploying === project.slug ? "Deploying…" : "Redeploy"}
                        </button>
                      </div>
                    </div>

                    {/* Compose Services */}
                    {project.services.length > 0 ? (
                      <div className="mb-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted">
                            Compose Services ({project.services.length})
                          </h4>
                          {selected.length > 0 && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setConfirmCompose({ slug: project.slug, type: "up-selected" })}
                                disabled={!!composeAction}
                                className="px-2 py-1 text-[9px] font-mono bg-success/10 border border-success/30 text-success rounded hover:bg-success/20 transition-colors disabled:opacity-50"
                              >
                                Up selected
                              </button>
                              <button
                                onClick={() => setConfirmCompose({ slug: project.slug, type: "down-selected" })}
                                disabled={!!composeAction}
                                className="px-2 py-1 text-[9px] font-mono bg-warning/10 border border-warning/30 text-warning rounded hover:bg-warning/20 transition-colors disabled:opacity-50"
                              >
                                Down selected
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                          {project.services.map((svc) => {
                            const existing = meta.containers.find(
                              (c) =>
                                tokensMatch(c.composeService || "", svc.name) ||
                                c.name.toLowerCase().includes(svc.name.toLowerCase())
                            );
                            const isRunning = existing?.state === "running";
                            const checked = isServiceSelected(project.slug, svc.name);
                            return (
                              <div
                                key={svc.name}
                                className={`flex items-center justify-between p-2 rounded-lg border ${
                                  isRunning ? "bg-background/50 border-border/50" : "bg-warning/5 border-warning/10"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleService(project.slug, svc.name)}
                                    className="shrink-0 accent-accent"
                                    title="Select service"
                                  />
                                  <div className="min-w-0">
                                    <div className="text-xs font-mono truncate">{svc.name}</div>
                                    <div className="text-[10px] text-muted font-mono truncate">
                                      {svc.image || (svc.build ? "build" : "no image")}
                                      {svc.ports && svc.ports.length > 0 ? ` · :${svc.ports[0]}` : ""}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  {existing ? (
                                    <div
                                      className={`w-2 h-2 rounded-full ${isRunning ? "bg-success" : "bg-error"}`}
                                      title={isRunning ? "running" : "stopped"}
                                    />
                                  ) : (
                                    <span className="text-[9px] font-mono text-accent">new</span>
                                  )}
                                  {(!existing || existing.state !== "running") && (
                                    <button
                                      onClick={() => startService(project.slug, svc.name)}
                                      className="px-2 py-0.5 text-[9px] font-mono border border-success/30 text-success rounded hover:bg-success/10 transition-colors"
                                    >
                                      start
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="text-[10px] text-muted font-mono truncate">
                          cd {project.path} && docker compose pull && docker compose up -d --remove-orphans
                        </div>
                      </div>
                    ) : (
                      <div className="mb-4 text-[10px] text-warning font-mono bg-warning/5 p-2 rounded-lg">
                        Compose file at {project.composePath} declared no parseable services.
                      </div>
                    )}

                    {/* Compose action output */}
                    {composeOutput?.slug === project.slug && (
                      <div className="mb-4 space-y-1">
                        {composeOutput.error && (
                          <div className="text-[10px] font-mono text-error bg-error/5 border border-error/20 rounded p-2 whitespace-pre-wrap">
                            {composeOutput.error}
                          </div>
                        )}
                        {composeOutput.output && (
                          <pre className="text-[10px] font-mono text-foreground/80 bg-background border border-border rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">
                            {composeOutput.output}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Related Containers */}
                    {meta.containers.length > 0 && (
                      <div className="mb-4 space-y-2">
                        <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted">
                          Containers ({meta.containers.length})
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                          {meta.containers.map((c) => {
                            const ctype = getContainerType(c.name, c.image);
                            const isRunning = c.state === "running";
                            return (
                              <a
                                key={c.name}
                                href="/containers"
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
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Related Images */}
                    {meta.images.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted">
                          Images ({meta.images.length})
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                          {meta.images.map((img) => {
                            const fullName =
                              img.tag && img.tag !== "<none>" ? `${img.repository}:${img.tag}` : img.repository;
                            return (
                              <a
                                key={img.id}
                                href="/containers"
                                className="flex items-center justify-between p-2 rounded-lg border border-border/50 bg-background/30 hover:border-border-hover transition-colors"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-mono truncate">{fullName}</div>
                                  <div className="text-[10px] text-muted font-mono">{img.size}</div>
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Plain (compose-less) folders — surfaced so nothing is hidden. */}
          {data?.plainDirs && data.plainDirs.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-mono uppercase tracking-wider text-muted">
                Other folders (no compose)
              </h2>
              <div className="flex flex-wrap gap-2">
                {data.plainDirs
                  .filter((d) => d.toLowerCase() !== "groundcontrol")
                  .map((d) => (
                    <span
                      key={d}
                      className="text-xs font-mono text-muted bg-card border border-border rounded-lg px-3 py-1.5"
                      title={`${projectRoot}/${d}`}
                    >
                      {d}/
                    </span>
                  ))}
              </div>
            </div>
          )}
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

      {confirmCompose && (
        <ActionConfirm
          open={!!confirmCompose}
          action={confirmCompose.type.startsWith("up") ? "compose-up" : "compose-down"}
          targetName={`${confirmCompose.slug}${selectedServicesFor(confirmCompose.slug).length > 0 && confirmCompose.type.endsWith("selected") ? ` (${selectedServicesFor(confirmCompose.slug).join(", ")})` : ""}`}
          targetType="Project"
          onConfirm={() =>
            runCompose(
              confirmCompose.slug,
              confirmCompose.type.startsWith("up") ? "up" : "down",
              confirmCompose.type.endsWith("selected") ? selectedServicesFor(confirmCompose.slug) : undefined
            )
          }
          onCancel={() => setConfirmCompose(null)}
        />
      )}
    </div>
  );
}
