"use client";

import { useEffect, useState, useMemo } from "react";
import { SensitiveField } from "@/components/SensitiveField";
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
}

interface DockerImage {
  repository: string;
  tag: string;
  id: string;
  size: string;
  createdAt: string;
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

interface ProjectData {
  directories: string[];
  caddySites: CaddySite[];
}

function deriveProjectName(slug: string): string {
  const map: Record<string, string> = {
    urbanize: "Urbanize",
    perfume: "Perfume Emporio",
    "perfume-emporio": "Perfume Emporio",
    optimi: "Optimi",
    rentaweekend: "Rent My Weekend",
    "rent-my-weekend": "Rent My Weekend",
    groundcontrol: "GroundControl",
    infisical: "Infisical",
  };
  return map[slug] || slug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export default function ProjectsPage() {
  const [data, setData] = useState<ProjectData | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [composeData, setComposeData] = useState<Map<string, ComposeInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [confirmDeploy, setConfirmDeploy] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState("/opt");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/containers").then((r) => r.json()),
      fetch("/api/docker-images").then((r) => r.json()),
      fetch("/api/system-config")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([projectsData, containersData, imagesData, config]) => {
        setData(projectsData);
        setContainers(containersData);
        setImages(imagesData);
        if (config?.projectRoot) setProjectRoot(config.projectRoot);
        setLoading(false);

        // Fetch compose files for each project directory
        const dirs = (projectsData?.directories || []).filter((d: string) => d !== "groundcontrol");
        for (const slug of dirs) {
          fetch(`/api/projects/compose?slug=${slug}`)
            .then((r) => r.json())
            .then((compose) => {
              setComposeData((prev) => {
                const next = new Map(prev);
                next.set(slug, compose);
                return next;
              });
            })
            .catch(() => {});
        }
      })
      .catch((err) => {
        setError(err.message);
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
      const data = await res.json();
      if (data.error) setError(`Deploy failed: ${data.error}`);
      else setError("");
    } catch (err: any) {
      setError(`Deploy failed: ${err.message}`);
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
      const data = await res.json();
      if (!data.success && data.error) {
        setError(`Start service failed: ${data.error}`);
      } else {
        setError("");
      }
    } catch (err: any) {
      setError(`Start service failed: ${err.message}`);
    }
  }

  const slugs = useMemo(
    () => (data?.directories || []).filter((d) => d !== "groundcontrol"),
    [data]
  );

  // Match containers/images to each project
  const projectMeta = useMemo(() => {
    const result = new Map<
      string,
      { containers: Container[]; images: DockerImage[]; compose: ComposeInfo | undefined }
    >();
    for (const slug of slugs) {
      const projSlugLower = slug.toLowerCase();
      const projPath = `${projectRoot}/${slug}`.toLowerCase().replace(/\/$/, "");
      const matchedContainers: Container[] = [];

      for (const c of containers) {
        const composeProj = (c.composeProject || "").toLowerCase();
        const cName = c.name.toLowerCase();
        const workingDir = (c.composeWorkingDir || "").toLowerCase().replace(/\/$/, "");
        const nameBase = cName.replace(/[-_]\d+$/, "");

        const matches =
          (composeProj && (composeProj === projSlugLower || composeProj.includes(projSlugLower) || projSlugLower.includes(composeProj))) ||
          (workingDir && (workingDir === projPath || workingDir.startsWith(projPath + "/"))) ||
          (projSlugLower.length > 2 &&
            (cName.startsWith(projSlugLower + "-") ||
              cName.startsWith(projSlugLower + "_") ||
              nameBase.startsWith(projSlugLower + "-") ||
              nameBase.startsWith(projSlugLower + "_")));

        if (matches) matchedContainers.push(c);
      }

      const compose = composeData.get(slug);
      const composeImages = new Set((compose?.services || []).map((s) => s.image).filter(Boolean));
      const matchedImages = images.filter((img) => {
        const fullName = img.tag && img.tag !== "<none>" ? `${img.repository}:${img.tag}` : img.repository;
        return composeImages.has(fullName) || composeImages.has(img.repository);
      });

      result.set(slug, { containers: matchedContainers, images: matchedImages, compose });
    }
    return result;
  }, [slugs, containers, images, composeData, projectRoot]);

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted mt-1">Everything under {projectRoot}</p>
        </div>
        <div className="animate-pulse space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 bg-card border border-border rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <p className="text-muted mt-1">Everything under {projectRoot}</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:text-foreground">✕</button>
        </div>
      )}

      {slugs.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 text-muted text-sm">
          No projects found in {projectRoot}/. Deploy a repo to <code>{projectRoot}/&lt;slug&gt;/</code> to see it here.
        </div>
      ) : (
        <div className="space-y-6">
          {slugs.map((slug) => {
            const meta = projectMeta.get(slug) || { containers: [], images: [], compose: undefined };
            const running = meta.containers.filter((c) => c.state === "running").length;
            const stopped = meta.containers.filter((c) => c.state !== "running").length;
            const site = data?.caddySites.find((s) => s.domain.includes(slug.replace(/-/g, "")));

            return (
              <div
                key={slug}
                className="bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium text-lg">{deriveProjectName(slug)}</h3>
                      <span className="text-[10px] font-mono text-muted bg-border/50 px-1.5 py-0.5 rounded">
                        {slug}
                      </span>
                      {meta.containers.length > 0 && (
                        <span className="text-[10px] font-mono text-success bg-success/10 px-1.5 py-0.5 rounded">
                          {running} up{stopped > 0 ? ` · ${stopped} down` : ""}
                        </span>
                      )}
                    </div>
                    {site ? (
                      <p className="text-xs text-accent font-mono mt-1">{site.domain}</p>
                    ) : (
                      <p className="text-xs text-muted font-mono mt-1">No domain mapped</p>
                    )}
                    <p className="text-xs text-muted font-mono mt-0.5">
                      {projectRoot}/{slug}
                    </p>
                  </div>
                  <button
                    onClick={() => setConfirmDeploy(slug)}
                    disabled={deploying === slug}
                    className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
                  >
                    {deploying === slug ? "Deploying..." : "Redeploy"}
                  </button>
                </div>

                {/* Compose Services */}
                {meta.compose && meta.compose.services && meta.compose.services.length > 0 ? (
                  <div className="mb-4 space-y-2">
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted">
                      Compose Services ({meta.compose.services.length})
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {meta.compose.services.map((svc) => {
                        const existing = meta.containers.find(
                          (c) => c.composeService === svc.name || c.name.toLowerCase().includes(svc.name.toLowerCase())
                        );
                        const isRunning = existing?.state === "running";
                        return (
                          <div
                            key={svc.name}
                            className={`flex items-center justify-between p-2 rounded-lg border ${
                              isRunning ? "bg-background/50 border-border/50" : "bg-warning/5 border-warning/10"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-mono truncate">{svc.name}</div>
                              <div className="text-[10px] text-muted font-mono truncate">
                                {svc.image || (svc.build ? "📦 build" : "no image")}
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
                              {existing?.state !== "running" && (
                                <button
                                  onClick={() => startService(slug, svc.name)}
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
                    <div className="text-[10px] text-muted font-mono">
                      cd {projectRoot}/{slug} && docker compose pull && docker compose up -d --remove-orphans
                    </div>
                  </div>
                ) : (
                  <div className="mb-4 text-[10px] text-warning font-mono bg-warning/5 p-2 rounded-lg">
                    No compose file found at {projectRoot}/{slug}/docker-compose.yml
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
                        const fullName = img.tag && img.tag !== "<none>" ? `${img.repository}:${img.tag}` : img.repository;
                        return (
                          <a
                            key={img.id}
                            href="/containers"
                            onClick={(e) => {
                              e.preventDefault();
                              window.location.href = "/containers";
                            }}
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
