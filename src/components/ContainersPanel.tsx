"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { SensitiveField } from "@/components/SensitiveField";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ActionConfirm } from "@/components/ActionConfirm";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { ContainerIcon, getContainerType } from "@/components/TopoIcons";

const CONTAINERS_POLL_MS = 8000;
const IMAGES_POLL_MS = 30000;

interface Container {
  name: string;
  image: string;
  status: string;
  ports: string;
  id: string;
  state: string;
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
  composeConfigFiles?: string;
  projectSlug?: string;
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

interface ContainerStateResult {
  name: string;
  id: string;
  state: string;
  status: string;
  removed: boolean;
}

interface ActionResult {
  success: boolean;
  action: "start" | "stop" | "restart" | "remove";
  name: string;
  output: string;
  error: string;
  container: ContainerStateResult | null;
}

interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

const ACTION_PAST: Record<string, string> = {
  start: "started",
  stop: "stopped",
  restart: "restarted",
  remove: "removed",
};

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

export function ContainersPanel() {
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [bulkRemoveConfirm, setBulkRemoveConfirm] = useState(false);

  const containersAbort = useRef<AbortController | null>(null);
  const imagesAbort = useRef<AbortController | null>(null);
  const containersInFlight = useRef(false);
  const imagesInFlight = useRef(false);
  const toastSeq = useRef(0);

  const pushToast = useCallback((kind: "success" | "error", message: string) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 5000);
  }, []);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [nameFilter, setNameFilter] = useState<string>("");
  const [imageRepoFilter, setImageRepoFilter] = useState<string>("");

  const [runModal, setRunModal] = useState<{
    image: string;
    name: string;
    ports: string;
    env: string;
    command: string;
  } | null>(null);

  const [pruneRepoTarget, setPruneRepoTarget] = useState<string | null>(null);

  const fetchContainers = useCallback(async () => {
    if (containersInFlight.current) return;
    containersInFlight.current = true;
    containersAbort.current?.abort();
    const controller = new AbortController();
    containersAbort.current = controller;
    try {
      const res = await fetch("/api/containers", { signal: controller.signal });
      const { data } = await safeJson(res);
      if (Array.isArray(data)) {
        setContainers(data);
        setError("");
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") setError(err.message);
    } finally {
      containersInFlight.current = false;
      setLoading(false);
    }
  }, []);

  const fetchImages = useCallback(async () => {
    if (imagesInFlight.current) return;
    imagesInFlight.current = true;
    imagesAbort.current?.abort();
    const controller = new AbortController();
    imagesAbort.current = controller;
    try {
      const res = await fetch("/api/docker-images", { signal: controller.signal });
      const { data } = await safeJson(res);
      if (Array.isArray(data)) {
        setImages(data);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") console.error(err);
    } finally {
      imagesInFlight.current = false;
      setImagesLoading(false);
    }
  }, []);

  function toggleSelection(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map((c) => c.name)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function runBulkAction(action: "start" | "stop" | "restart" | "remove") {
    if (selected.size === 0) return;
    setBulkActionLoading(true);
    try {
      const res = await fetch("/api/containers/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, names: Array.from(selected) }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.results) {
        const detail = data?.error || "Unknown error";
        const msg = `Bulk ${action} failed — ${detail}`;
        setError(msg);
        pushToast("error", msg);
      } else {
        const failures = data.results.filter((r: ActionResult & { name: string }) => !r.success);
        const successes = data.results.filter((r: ActionResult & { name: string }) => r.success);
        if (successes.length > 0) {
          pushToast("success", `${action} succeeded for ${successes.length} container${successes.length === 1 ? "" : "s"}`);
        }
        if (failures.length > 0) {
          const msg = failures.map((f: ActionResult & { name: string }) => `${f.name}: ${f.error}`).join("; ");
          setError(`Bulk ${action} had ${failures.length} failure(s): ${msg}`);
          pushToast("error", `${action} failed for ${failures.length} container${failures.length === 1 ? "" : "s"}`);
        } else {
          setError("");
        }
        setSelected(new Set());
      }
      await fetchContainers();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `Bulk ${action} failed — ${detail}`;
      setError(msg);
      pushToast("error", msg);
    } finally {
      setBulkActionLoading(false);
      setBulkRemoveConfirm(false);
    }
  }

  const fetchCompose = useCallback(async () => {
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
      if (err instanceof Error) console.error(err.message);
    }
  }, []);

  useEffect(() => {
    let containersTimer: ReturnType<typeof setInterval> | null = null;
    let imagesTimer: ReturnType<typeof setInterval> | null = null;

    async function initialLoad() {
      await fetchContainers();
      await fetchImages();
      await fetchCompose();
    }

    function startPolling() {
      if (!containersTimer) {
        containersTimer = setInterval(() => {
          if (!document.hidden) fetchContainers();
        }, CONTAINERS_POLL_MS);
      }
      if (!imagesTimer) {
        imagesTimer = setInterval(() => {
          if (!document.hidden) fetchImages();
        }, IMAGES_POLL_MS);
      }
    }

    function stopPolling() {
      if (containersTimer) { clearInterval(containersTimer); containersTimer = null; }
      if (imagesTimer) { clearInterval(imagesTimer); imagesTimer = null; }
      containersAbort.current?.abort();
      imagesAbort.current?.abort();
    }

    function handleVisibility() {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchContainers();
        startPolling();
      }
    }

    initialLoad();
    startPolling();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopPolling();
    };
  }, [fetchContainers, fetchImages, fetchCompose]);

  function reconcileContainer(result: ActionResult) {
    setContainers((prev) => {
      if (result.action === "remove" && (result.container === null || result.container.removed)) {
        return prev.filter((c) => c.name !== result.name);
      }
      const fresh = result.container;
      if (!fresh) return prev;
      return prev.map((c) =>
        c.name === result.name
          ? { ...c, state: fresh.state || c.state, status: fresh.status || c.status, id: fresh.id || c.id }
          : c
      );
    });
  }

  async function handleAction(action: "start" | "stop" | "restart" | "remove", name: string) {
    setActionLoading(name);
    try {
      const res = await fetch("/api/containers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name }),
      });
      const { ok, data } = await safeJson(res);
      const result = data as ActionResult;

      if (!ok || !result.success) {
        const detail = (result?.error || data?.error || "Unknown error").trim();
        const msg = `${name}: ${action} failed${detail ? ` — ${detail}` : ""}`;
        setError(msg);
        pushToast("error", msg);
      } else {
        setError("");
        reconcileContainer(result);
        const verb = ACTION_PAST[action] || action;
        const statusHint = result.container?.status ? ` (${result.container.status})` : "";
        pushToast("success", `${name} ${verb}${statusHint}`);
      }
      await fetchContainers();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `${name}: ${action} failed — ${detail}`;
      setError(msg);
      pushToast("error", msg);
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
        const msg = `Start service failed: ${data.error || "Unknown error"}`;
        setError(msg);
        pushToast("error", msg);
      } else {
        setError("");
        pushToast("success", `${service} service started`);
        await fetchContainers();
      }
    } catch (err) {
      const msg = `Start service failed: ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      pushToast("error", msg);
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
    } catch (err) {
      setError(`Run failed: ${err instanceof Error ? err.message : String(err)}`);
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
    } catch (err) {
      setError(`Prune failed: ${err instanceof Error ? err.message : String(err)}`);
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
    } catch {
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

  const imageContext = useMemo(() => {
    const map = new Map<string, ImageContext>();

    for (const c of containers) {
      if (!map.has(c.image)) map.set(c.image, { containers: [] });
      map.get(c.image)!.containers.push(c);
      if (c.composeProject && c.composeService) {
        map.get(c.image)!.projectSlug = c.projectSlug || c.composeProject;
        map.get(c.image)!.service = c.composeService;
      }
    }

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

  const actionLoader = useMemo(() => {
    if (!actionLoading) return null;
    if (actionLoading === "run") return { variant: "image" as const, title: "Running image..." };
    if (actionLoading === "prune-repo") return { variant: "image" as const, title: "Pruning images..." };
    if (actionLoading.startsWith("svc:")) return { variant: "compose" as const, title: "Starting compose service..." };
    return { variant: "container" as const, title: "Updating container..." };
  }, [actionLoading]);

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
          start service
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
            start container
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
    <div>
      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:text-foreground">✕</button>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`p-3 rounded-lg border text-xs font-mono shadow-lg flex items-start justify-between gap-2 ${
                t.kind === "success"
                  ? "bg-success/10 border-success/30 text-success"
                  : "bg-error/10 border-error/30 text-error"
              }`}
            >
              <span>{t.kind === "success" ? "✓ " : "✕ "}{t.message}</span>
              <button
                onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
                className="hover:text-foreground shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {actionLoading && actionLoader && (
        <LoaderOverlay3D open variant={actionLoader.variant} title={actionLoader.title} />
      )}
      {bulkActionLoading && (
        <LoaderOverlay3D open variant="container" title="Running bulk action..." />
      )}

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
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Filter by name..."
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent sm:w-48"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent sm:w-auto"
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

          {selected.size > 0 && (
            <div className="mb-4 flex flex-col gap-3 p-3 bg-accent/5 border border-accent/20 rounded-xl sm:flex-row sm:items-center">
              <span className="text-xs font-mono text-accent">{selected.size} selected</span>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button
                  onClick={() => runBulkAction("start")}
                  disabled={bulkActionLoading}
                  className="px-3 py-1.5 text-xs font-mono border border-success/30 text-success rounded hover:bg-success/10 transition-colors disabled:opacity-50"
                >
                  Start
                </button>
                <button
                  onClick={() => runBulkAction("stop")}
                  disabled={bulkActionLoading}
                  className="px-3 py-1.5 text-xs font-mono border border-warning/30 text-warning rounded hover:bg-warning/10 transition-colors disabled:opacity-50"
                >
                  Stop
                </button>
                <button
                  onClick={() => runBulkAction("restart")}
                  disabled={bulkActionLoading}
                  className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                >
                  Restart
                </button>
                <button
                  onClick={() => setBulkRemoveConfirm(true)}
                  disabled={bulkActionLoading}
                  className="px-3 py-1.5 text-xs font-mono border border-error/30 text-error rounded hover:bg-error/10 transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
              <div className="flex gap-2 sm:ml-auto">
                <button
                  onClick={selectAll}
                  className="text-xs text-muted hover:text-foreground transition-colors"
                >
                  all
                </button>
                <button
                  onClick={selectNone}
                  className="text-xs text-muted hover:text-foreground transition-colors"
                >
                  none
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <LoaderOverlay3D open variant="container" title="Loading containers..." />
          ) : (
            <div className="space-y-3">
              {filtered.map((container) => (
                <div
                  key={container.id}
                  className={`bg-card border rounded-xl p-4 hover:border-border-hover transition-colors ${
                    container.state !== "running" ? "border-error/20" : "border-border"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
                      <input
                        type="checkbox"
                        checked={selected.has(container.name)}
                        onChange={() => toggleSelection(container.name)}
                        className="w-4 h-4 accent-accent"
                        aria-label={`Select ${container.name}`}
                      />
                      <div
                        className={`w-3 h-3 rounded-full ${
                          container.state === "running"
                            ? container.status.includes("unhealthy")
                              ? "bg-warning"
                              : "bg-success"
                          : "bg-error"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="font-medium flex min-w-0 items-center gap-2">
                          <ContainerIcon type={getContainerType(container.name, container.image)} className="w-4 h-4 text-muted" />
                          <span className="truncate">{container.name}</span>
                        </div>
                        <div className="text-xs text-muted font-mono mt-0.5 truncate">
                          {container.image} · {container.status}
                        </div>
                        {(container.composeProject || container.composeWorkingDir) && (
                          <div className="text-[10px] text-muted font-mono mt-1 truncate">
                            {container.composeProject && (
                              <span>compose {container.composeProject}</span>
                            )}
                            {container.composeService && (
                              <span>/{container.composeService}</span>
                            )}
                            {container.composeWorkingDir && (
                              <span> · {container.composeWorkingDir}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
                      {container.stats && container.state === "running" && (
                        <div className="hidden md:flex gap-4 text-xs font-mono text-muted">
                          <span>CPU {container.stats.cpu}</span>
                          <span>MEM {container.stats.mem}</span>
                          <span>PIDs {container.stats.pids}</span>
                        </div>
                      )}

                      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
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
                              restart
                            </button>
                            <button
                              onClick={() => setPendingAction({ action: "stop", name: container.name })}
                              disabled={actionLoading === container.name}
                              className="px-3 py-1.5 text-xs font-mono border border-error/30 text-error rounded hover:bg-error/10 transition-colors disabled:opacity-50"
                            >
                              stop
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setPendingAction({ action: "start", name: container.name })}
                            disabled={actionLoading === container.name}
                            className="px-3 py-1.5 text-xs font-mono border border-success/30 text-success rounded hover:bg-success/10 transition-colors disabled:opacity-50"
                          >
                            start
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
            <LoaderOverlay3D open variant="image" title="Loading images..." />
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
                    <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-mono font-medium truncate flex items-center gap-2">
                          <ContainerIcon type={getContainerType(group.repository, "")} className="w-4 h-4 text-muted" />
                          {group.repository}
                        </div>
                        <div className="text-[10px] text-muted font-mono mt-0.5">
                          {group.images.length} tag{group.images.length > 1 ? "s" : ""} · {totalSizeStr} total
                        </div>
                      </div>
                      <div className="flex gap-2 sm:ml-4 sm:shrink-0">
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
                            className={`flex flex-col gap-2 p-2 rounded-lg border sm:flex-row sm:items-center sm:justify-between ${
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
                            <div className="flex w-full items-center justify-between gap-3 sm:ml-4 sm:w-auto sm:justify-end sm:shrink-0">
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

      {bulkRemoveConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center border border-error/30 text-error">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium">Remove Containers</h3>
                <p className="text-xs text-muted mt-0.5 font-mono">{selected.size} selected</p>
              </div>
            </div>
            <div className="border border-error/20 bg-error/5 rounded-lg p-3 mb-4 text-xs text-error/80">
              <span className="font-semibold">Consequence: </span>
              This will permanently delete the selected containers and their logs. Data in volumes will be preserved.
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setBulkRemoveConfirm(false)}
                className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => runBulkAction("remove")}
                disabled={bulkActionLoading}
                className="px-4 py-2 text-xs font-mono border border-error/30 text-error bg-error/10 hover:bg-error/20 rounded-lg transition-colors disabled:opacity-50"
              >
                Confirm Remove
              </button>
            </div>
          </div>
        </div>
      )}

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
                For compose-managed services, use Deployments or start the existing container instead.
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
                Run Standalone
              </button>
            </div>
          </div>
        </div>
      )}

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
                Prune Old Tags
              </button>
            </div>
          </div>
        </div>
      )}

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
