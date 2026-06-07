"use client";

import { useEffect, useState, useMemo } from "react";
import { SensitiveField } from "@/components/SensitiveField";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ActionConfirm } from "@/components/ActionConfirm";

interface Container {
  name: string;
  image: string;
  status: string;
  ports: string;
  id: string;
  state: string;
  composeProject?: string;
  composeService?: string;
  stats?: {
    cpu: string;
    mem: string;
    net: string;
    block: string;
    pids: string;
  };
}

interface DockerImage {
  repository: string;
  tag: string;
  id: string;
  size: string;
  createdAt: string;
}

interface ImageGroup {
  repository: string;
  images: DockerImage[];
}

interface ComposeService {
  name: string;
  image?: string;
  build?: boolean;
}

interface ComposeInfo {
  services: ComposeService[];
}

interface ImageContext {
  projectSlug?: string;
  service?: string;
  containers: Container[];
}

async function safeJson(res: Response): Promise<{ ok: boolean; data: any; text: string }> {
  const text = await res.text();
  try {
    const data = text ? JSON.parse(text) : {};
    return { ok: res.ok, data, text };
  } catch {
    return { ok: res.ok, data: { error: text || "Invalid response" }, text };
  }
}

export default function ContainersPage() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [composeData, setComposeData] = useState<Map<string, ComposeInfo>>(new Map());
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ action: "start" | "stop" | "restart"; name: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"containers" | "images">("containers");
  const [error, setError] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [nameFilter, setNameFilter] = useState<string>("");
  const [imageRepoFilter, setImageRepoFilter] = useState<string>("");

  // Run image modal (standalone only)
  const [runModal, setRunModal] = useState<{
    image: string;
    name: string;
    ports: string;
    env: string;
    command: string;
  } | null>(null);

  // Prune repo modal
  const [pruneRepoTarget, setPruneRepoTarget] = useState<string | null>(null);

  async function fetchContainers() {
    try {
      const res = await fetch("/api/containers");
      const { data } = await safeJson(res);
      if (Array.isArray(data)) {
        setContainers(data);
        setError("");
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchImages() {
    try {
      const res = await fetch("/api/docker-images");
      const { data } = await safeJson(res);
      if (Array.isArray(data)) {
        setImages(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setImagesLoading(false);
    }
  }

  async function fetchCompose() {
    try {
      const res = await fetch("/api/projects");
      const { data } = await safeJson(res);
      const dirs = (data?.directories || []).filter((d: string) => d !== "groundcontrol");
      for (const slug of dirs) {
        fetch(`/api/projects/compose?slug=${slug}`)
          .then((r) => safeJson(r))
          .then(({ data: compose }) => {
            setComposeData((prev) => {
              const next = new Map(prev);
              next.set(slug, compose);
              return next;
            });
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    fetchContainers();
    fetchImages();
    fetchCompose();
    const interval = setInterval(() => {
      fetchContainers();
      fetchImages();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleAction(action: "start" | "stop" | "restart" | "remove", name: string) {
    setActionLoading(name);
    try {
      const res = await fetch("/api/containers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name }),
      });
      const { data } = await safeJson(res);
      if (!data.success && data.error) {
        setError(`Action failed: ${data.error}`);
      } else {
        setError("");
      }
      await fetchContainers();
    } finally {
      setActionLoading(null);
      setRemoveTarget(null);
      setPendingAction(null);
    }
  }

  async function handleStartService(projectSlug: string, service: string) {
    setActionLoading(`svc:${projectSlug}/${service}`);
    try {
      const res = await fetch("/api/compose-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug, service }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || (!data.success && data.error)) {
        setError(`Start service failed: ${data.error || "Unknown error"}`);
      } else {
        setError("");
        await fetchContainers();
      }
    } catch (err: any) {
      setError(`Start service failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRunImage() {
    if (!runModal) return;
    setActionLoading("run");
    try {
      const ports = runModal.ports ? runModal.ports.split(",").map((p) => p.trim()).filter(Boolean) : [];
      const env = runModal.env ? runModal.env.split(",").map((e) => e.trim()).filter(Boolean) : [];
      const res = await fetch("/api/images/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: runModal.image,
          name: runModal.name || undefined,
          ports: ports.length > 0 ? ports : undefined,
          env: env.length > 0 ? env : undefined,
          command: runModal.command || undefined,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || (!data.success && data.error)) {
        setError(`Run failed: ${data.error || "Unknown error"}`);
      } else {
        setError("");
        await fetchContainers();
        await fetchImages();
      }
    } catch (err: any) {
      setError(`Run failed: ${err.message}`);
    } finally {
      setActionLoading(null);
      setRunModal(null);
    }
  }

  async function handlePruneRepo() {
    if (!pruneRepoTarget) return;
    setActionLoading("prune-repo");
    try {
      const res = await fetch("/api/images/prune-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository: pruneRepoTarget }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setError(`Prune failed: ${data.error || "Unknown error"}`);
      } else {
        setError(data.errors?.length > 0 ? `Pruned ${data.removed?.length || 0}, errors: ${data.errors.join("; ")}` : "");
        await fetchImages();
        await fetchContainers();
      }
    } catch (err: any) {
      setError(`Prune failed: ${err.message}`);
    } finally {
      setActionLoading(null);
      setPruneRepoTarget(null);
    }
  }

  async function viewLogs(name: string) {
    setSelectedContainer(name);
    try {
      const res = await fetch(`/api/containers/logs?name=${name}&tail=200`);
      const { data } = await safeJson(res);
      setLogs(data.logs || "No logs available");
    } catch (err) {
      setLogs("Failed to fetch logs");
    }
  }

  const filtered = containers.filter((c) => {
    if (nameFilter && !c.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
    if (statusFilter === "running") return c.state === "running" && !c.status.includes("unhealthy");
    if (statusFilter === "stopped") return c.state !== "running";
    if (statusFilter === "unhealthy") return c.status.includes("unhealthy");
    if (statusFilter === "unknown") return !c.state || c.state === "unknown";
    return true;
  });

  const counts = {
    all: containers.length,
    running: containers.filter((c) => c.state === "running" && !c.status.includes("unhealthy")).length,
    stopped: containers.filter((c) => c.state !== "running").length,
    unhealthy: containers.filter((c) => c.status.includes("unhealthy")).length,
  };

  // Build image context from compose files + existing containers
  const imageContext = useMemo(() => {
    const map = new Map<string, ImageContext>();

    // Seed from existing containers
    for (const c of containers) {
      if (!map.has(c.image)) map.set(c.image, { containers: [] });
      map.get(c.image)!.containers.push(c);
      if (c.composeProject && c.composeService) {
        map.get(c.image)!.projectSlug = c.composeProject;
        map.get(c.image)!.service = c.composeService;
      }
    }

    // Augment from compose files
    for (const [slug, compose] of composeData) {
      for (const svc of compose?.services || []) {
        if (!svc.image) continue;
        const ctx = map.get(svc.image) || { containers: [] };
        ctx.projectSlug = slug;
        ctx.service = svc.name;
        map.set(svc.image, ctx);
      }
    }

    return map;
  }, [containers, composeData]);

  // Group images by repository, sort tags by createdAt desc
  const groupedImages: ImageGroup[] = useMemo(() => {
    const map = new Map<string, DockerImage[]>();
    for (const img of images) {
      if (!map.has(img.repository)) map.set(img.repository, []);
      map.get(img.repository)!.push(img);
    }
    const groups: ImageGroup[] = [];
    for (const [repository, imgs] of map) {
      imgs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      groups.push({ repository, images: imgs });
    }
    groups.sort((a, b) => b.images.length - a.images.length);
    return groups;
  }, [images]);

  const filteredGroups = groupedImages.filter((g) =>
    !imageRepoFilter || g.repository.toLowerCase().includes(imageRepoFilter.toLowerCase())
  );

  function parseSize(sizeStr: string): number {
    const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const mults: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
    return val * (mults[unit] || 1);
  }

  function openRunModal(image: string) {
    const suggestedName = image.replace(/[^a-zA-Z0-9_-]/g, "-").substring(0, 40);
    setRunModal({ image, name: suggestedName, ports: "", env: "", command: "" });
  }

  function renderImageAction(fullName: string, ctx: ImageContext | undefined) {
    if (ctx?.projectSlug && ctx?.service) {
      const hasRunning = ctx.containers.some((c) => c.state === "running");
      const hasStopped = ctx.containers.some((c) => c.state !== "running");
      const loadingKey = `svc:${ctx.projectSlug}/${ctx.service}`;
      if (hasRunning && !hasStopped) {
        return (
          <span className="text-[10px] font-mono text-success shrink-0">
            compose service running
          </span>
        );
      }
      return (
        <button
          onClick={() => handleStartService(ctx.projectSlug!, ctx.service!)}
          disabled={actionLoading === loadingKey}
          className="px-2 py-1 text-[10px] font-mono border border-success/30 text-success rounded hover:bg-success/10 transition-colors disabled:opacity-50 shrink-0"
        >
          {actionLoading === loadingKey ? "..." : "start service"}
        </button>
      );
    }

    if (ctx?.containers && ctx.containers.length > 0) {
      const stopped = ctx.containers.find((c) => c.state !== "running");
      const running = ctx.containers.find((c) => c.state === "running");
      if (stopped) {
        return (
          <button
            onClick={() => handleAction("start", stopped.name)}
            disabled={actionLoading === stopped.name}
            className="px-2 py-1 text-[10px] font-mono border border-success/30 text-success rounded hover:bg-success/10 transition-colors disabled:opacity-50 shrink-0"
          >
            {actionLoading === stopped.name ? "..." : "start container"}
          </button>
        );
      }
      if (running) {
        return (
          <span className="text-[10px] font-mono text-success shrink-0">
            container running
          </span>
        );
      }
    }

    // Orphaned image — allow standalone run with warning
    return (
      <button
        onClick={() => openRunModal(fullName)}
        disabled={actionLoading === "run"}
        className="px-2 py-1 text-[10px] font-mono border border-muted/30 text-muted rounded hover:border-warning hover:text-warning transition-colors disabled:opacity-50 shrink-0"
      >
        run standalone
      </button>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Containers</h1>
        <p className="text-muted mt-1">Manage Docker containers and images on your VPS</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:text-foreground">✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab("containers")}
          className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
            activeTab === "containers"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          Containers ({containers.length})
        </button>
        <button
          onClick={() => setActiveTab("images")}
          className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
            activeTab === "images"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          Images ({images.length})
        </button>
      </div>

      {activeTab === "containers" ? (
        <>
          {/* Filters */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Filter by name..."
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent w-48"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent"
            >
              <option value="">All ({counts.all})</option>
              <option value="running">Running ({counts.running})</option>
              <option value="stopped">Stopped ({counts.stopped})</option>
              <option value="unhealthy">Unhealthy ({counts.unhealthy})</option>
            </select>
            {(statusFilter || nameFilter) && (
              <button
                onClick={() => { setStatusFilter(""); setNameFilter(""); }}
                className="text-xs text-muted hover:text-foreground transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-4 h-20 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((container) => (
                <div
                  key={container.id}
                  className={`bg-card border rounded-xl p-4 hover:border-border-hover transition-colors ${
                    container.state !== "running" ? "border-error/20" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          container.state === "running"
                            ? container.status.includes("unhealthy")
                              ? "bg-warning"
                              : "bg-success"
                            : "bg-error"
                        }`}
                      />
                      <div>
                        <div className="font-medium">{container.name}</div>
                        <div className="text-xs text-muted font-mono mt-0.5">
                          {container.image} · {container.status}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {container.stats && container.state === "running" && (
                        <div className="hidden md:flex gap-4 text-xs font-mono text-muted">
                          <span>CPU {container.stats.cpu}</span>
                          <span>MEM {container.stats.mem}</span>
                          <span>PIDs {container.stats.pids}</span>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => viewLogs(container.name)}
                          className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                        >
                          logs
                        </button>
                        {container.state === "running" ? (
                          <>
                            <button
                              onClick={() => setPendingAction({ action: "restart", name: container.name })}
                              disabled={actionLoading === container.name}
                              className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                            >
                              {actionLoading === container.name ? "..." : "restart"}
                            </button>
                            <button
                              onClick={() => setPendingAction({ action: "stop", name: container.name })}
                              disabled={actionLoading === container.name}
                              className="px-3 py-1.5 text-xs font-mono border border-error/30 text-error rounded hover:bg-error/10 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === container.name ? "..." : "stop"}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setPendingAction({ action: "start", name: container.name })}
                            disabled={actionLoading === container.name}
                            className="px-3 py-1.5 text-xs font-mono border border-success/30 text-success rounded hover:bg-success/10 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === container.name ? "..." : "start"}
                          </button>
                        )}
                        <button
                          onClick={() => setRemoveTarget(container.name)}
                          disabled={actionLoading === container.name}
                          className="px-3 py-1.5 text-xs font-mono border border-muted/30 text-muted rounded hover:border-error hover:text-error transition-colors disabled:opacity-50"
                        >
                          remove
                        </button>
                      </div>
                    </div>
                  </div>

                  {container.ports && (
                    <div className="mt-2 text-xs text-muted font-mono pl-7">
                      <SensitiveField value={container.ports} />
                    </div>
                  )}
                </div>
              ))}

              {filtered.length === 0 && (
                <div className="text-center py-16 text-muted">
                  <p className="text-lg">No containers match your filters</p>
                  <p className="text-sm mt-1">Try adjusting your search criteria</p>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* Images Tab */
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Filter by repository..."
              value={imageRepoFilter}
              onChange={(e) => setImageRepoFilter(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent w-64"
            />
            {imageRepoFilter && (
              <button
                onClick={() => setImageRepoFilter("")}
                className="text-xs text-muted hover:text-foreground transition-colors"
              >
                Clear filter
              </button>
            )}
            <div className="ml-auto text-xs text-muted font-mono">
              {filteredGroups.length} repo{filteredGroups.length !== 1 ? "s" : ""} · {images.length} images
            </div>
          </div>

          {imagesLoading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-4 h-24 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map((group) => {
                const totalSize = group.images.reduce((sum, img) => sum + parseSize(img.size), 0);
                const totalSizeStr = totalSize > 1024 ** 3
                  ? `${(totalSize / 1024 ** 3).toFixed(2)}GB`
                  : totalSize > 1024 ** 2
                  ? `${(totalSize / 1024 ** 2).toFixed(0)}MB`
                  : `${(totalSize / 1024).toFixed(0)}KB`;
                return (
                  <div key={group.repository} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="min-w-0">
                        <div className="text-sm font-mono font-medium truncate">{group.repository}</div>
                        <div className="text-[10px] text-muted font-mono mt-0.5">
                          {group.images.length} tag{group.images.length > 1 ? "s" : ""} · {totalSizeStr} total
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0 ml-4">
                        {group.images.length > 1 && (
                          <button
                            onClick={() => setPruneRepoTarget(group.repository)}
                            disabled={actionLoading === "prune-repo"}
                            className="px-3 py-1.5 text-xs font-mono border border-warning/30 text-warning rounded hover:bg-warning/10 transition-colors disabled:opacity-50"
                          >
                            prune old
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {group.images.map((img, idx) => {
                        const fullName = img.tag && img.tag !== "<none>" ? `${img.repository}:${img.tag}` : img.id;
                        const ctx = imageContext.get(fullName);
                        const isLarge = parseSize(img.size) > 1024 ** 3;
                        return (
                          <div
                            key={img.id}
                            className={`flex items-center justify-between p-2 rounded-lg border ${
                              idx === 0 ? "bg-accent/5 border-accent/10" : "bg-background/30 border-border/30"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {idx === 0 && <span className="text-[9px] font-mono text-accent shrink-0">latest</span>}
                              <div className="min-w-0">
                                <div className="text-xs font-mono truncate">
                                  {img.tag && img.tag !== "<none>" ? img.tag : img.id}
                                </div>
                                <div className="text-[10px] text-muted font-mono">
                                  {img.id} · {img.createdAt}
                                  {ctx?.projectSlug && ctx?.service && (
                                    <span className="ml-2 text-accent">
                                      compose: {ctx.projectSlug}/{ctx.service}
                                    </span>
                                  )}
                                  {ctx?.containers && ctx.containers.length > 0 && !ctx?.projectSlug && (
                                    <span className="ml-2 text-success">
                                      used by {ctx.containers.map((c) => c.name).join(", ")}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-4">
                              <span className={`text-xs font-mono ${isLarge ? "text-warning" : "text-muted"}`}>
                                {img.size}
                              </span>
                              {renderImageAction(fullName, ctx)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {filteredGroups.length === 0 && (
                <div className="text-center py-16 text-muted">
                  <p className="text-lg">No images match your filter</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDelete
        open={!!removeTarget}
        resourceName={removeTarget || ""}
        resourceType="Container"
        onConfirm={() => {
          if (removeTarget) handleAction("remove", removeTarget);
        }}
        onCancel={() => setRemoveTarget(null)}
      />

      {pendingAction && (
        <ActionConfirm
          open={!!pendingAction}
          action={pendingAction.action}
          targetName={pendingAction.name}
          targetType="Container"
          onConfirm={() => handleAction(pendingAction.action, pendingAction.name)}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* Run Standalone Modal */}
      {runModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-mono text-sm">
                Run Standalone: <span className="text-accent">{runModal.image}</span>
              </h3>
              <button onClick={() => setRunModal(null)} className="text-muted hover:text-foreground transition-colors">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="p-2 bg-warning/5 border border-warning/10 rounded-lg text-[10px] text-warning font-mono">
                Warning: this creates a standalone container outside of docker compose.
                For compose-managed services, use Projects or start the existing container instead.
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase text-muted block mb-1">Container Name</label>
                <input
                  type="text"
                  value={runModal.name}
                  onChange={(e) => setRunModal({ ...runModal, name: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase text-muted block mb-1">Ports (comma-separated, e.g. 8080:80)</label>
                <input
                  type="text"
                  value={runModal.ports}
                  onChange={(e) => setRunModal({ ...runModal, ports: e.target.value })}
                  placeholder="8080:80, 3000:3000"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase text-muted block mb-1">Env Vars (comma-separated, e.g. KEY=value)</label>
                <input
                  type="text"
                  value={runModal.env}
                  onChange={(e) => setRunModal({ ...runModal, env: e.target.value })}
                  placeholder="NODE_ENV=production, PORT=3000"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase text-muted block mb-1">Command Override</label>
                <input
                  type="text"
                  value={runModal.command}
                  onChange={(e) => setRunModal({ ...runModal, command: e.target.value })}
                  placeholder="optional"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={() => setRunModal(null)}
                className="px-4 py-2 text-xs font-mono border border-border rounded hover:border-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRunImage}
                disabled={actionLoading === "run"}
                className="px-4 py-2 text-xs font-mono bg-success/10 border border-success/30 text-success rounded hover:bg-success/20 transition-colors disabled:opacity-50"
              >
                {actionLoading === "run" ? "Starting..." : "Run Standalone"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prune Repo Modal */}
      {pruneRepoTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
          <div className="bg-card border border-border rounded-xl w-full max-w-md flex flex-col">
            <div className="p-4 border-b border-border">
              <h3 className="font-mono text-sm">Prune Old Tags</h3>
              <p className="text-xs text-muted mt-1">
                Keep the most recent tag for <span className="text-accent font-mono">{pruneRepoTarget}</span> and remove all older tags.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={() => setPruneRepoTarget(null)}
                className="px-4 py-2 text-xs font-mono border border-border rounded hover:border-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePruneRepo}
                disabled={actionLoading === "prune-repo"}
                className="px-4 py-2 text-xs font-mono bg-warning/10 border border-warning/30 text-warning rounded hover:bg-warning/20 transition-colors disabled:opacity-50"
              >
                {actionLoading === "prune-repo" ? "Pruning..." : "Prune Old Tags"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {selectedContainer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
          <div className="bg-card border border-border rounded-xl w-full max-w-4xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-mono text-sm">
                Logs: <span className="text-accent">{selectedContainer}</span>
              </h3>
              <button
                onClick={() => setSelectedContainer(null)}
                className="text-muted hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>
            <pre className="flex-1 p-4 overflow-auto font-mono text-xs text-foreground/80 whitespace-pre-wrap scrollbar-thin">
              {logs}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
