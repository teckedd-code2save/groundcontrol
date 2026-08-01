"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Box,
  ChevronRight,
  Code2,
  ExternalLink,
  FolderGit2,
  Layers3,
  Pencil,
  RefreshCw,
  ServerCog,
  Settings2,
} from "lucide-react";
import { DeploymentEnvPanel } from "@/components/DeploymentEnvPanel";
import { ModalSurface } from "@/components/ModalSurface";
import { Notice, Tabs } from "@/components/ui";
import { deploymentRunProgress } from "@/lib/operator-progress";

type Group = { id: number; name: string; slug: string; description: string };
type Release = {
  id: number;
  status: string;
  branch: string;
  commitSha?: string | null;
  publicUrl?: string | null;
  previewUrl?: string | null;
  durationMs?: number | null;
  createdAt: string;
  target?: { name: string; type: string } | null;
  imageDigest?: string | null;
  previousImageDigest?: string | null;
  changedFields?: string | null;
};
type ContainerInfo = {
  name: string;
  image: string;
  state: string;
  status: string;
  service?: string | null;
};
type DeploymentDetailRecord = {
  id: number;
  name: string;
  slug: string;
  kind: string;
  managementMode: string;
  sourcePath?: string | null;
  composePath?: string | null;
  containerName?: string | null;
  status: string;
  observedStatus: string;
  projectId?: number | null;
  project?: Group | null;
  legacyProjectId?: number | null;
  legacyProjectSlug?: string | null;
  repoUrl?: string | null;
  domain?: string | null;
  publicUrl?: string | null;
  releases: Release[];
  envProfile?: {
    id: number;
    name: string;
    slug: string;
    providerType: string;
    environment: string;
    status: string;
  } | null;
  runtime?: {
    status: string;
    composeProject?: string | null;
    containers?: ContainerInfo[];
  } | null;
  runtimeEvents?: Array<{
    id: number;
    status: string;
    output?: string | null;
    error?: string | null;
    createdAt: string;
  }>;
  imageDigest?: string | null;
  previousImageDigest?: string | null;
  identitySource?: string;
};

type Tab = "manage" | "environment" | "releases" | "deploy";

async function readJson(response: Response) {
  try { return await response.json(); } catch { return {}; }
}

export default function DeploymentDetail({
  slug,
  initialTab,
}: {
  slug: string;
  initialTab?: string;
}) {
  const [deployment, setDeployment] = useState<DeploymentDetailRecord | null>(null);
  const [projects, setProjects] = useState<Group[]>([]);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("manage");
  const [projectOpen, setProjectOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [publicUrlInput, setPublicUrlInput] = useState("");
  const [repoUrlInput, setRepoUrlInput] = useState("");
  const [composeContent, setComposeContent] = useState("");
  const [composeLoading, setComposeLoading] = useState(false);
  const [imageSourceInput, setImageSourceInput] = useState("");
  const [imageService, setImageService] = useState("");
  const [imageRuntime, setImageRuntime] = useState("");
  const [imageConfigured, setImageConfigured] = useState("");
  const [imageHasOverride, setImageHasOverride] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [redeployLog, setRedeployLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [redeployStatus, setRedeployStatus] = useState<"idle" | "deploying" | "success" | "failed">("idle");
  const [runFailure, setRunFailure] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runElapsed, setRunElapsed] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deployment-inventory/${encodeURIComponent(slug)}`);
      const data = await readJson(res);
      if (!res.ok || data.error) {
        setMessage({ tone: "error", text: data.error || "Could not load deployment" });
        return;
      }
      setDeployment(data.deployment);
      setProjects(Array.isArray(data.projects) ? data.projects : []);
      setContainers(Array.isArray(data.deployment?.runtime?.containers) ? data.deployment.runtime.containers : []);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const resolved = ["environment", "releases", "deploy"].includes(initialTab || "") ? initialTab as Tab : "manage";
    setTab(resolved);
  }, [initialTab]);

  useEffect(() => {
    const latest = deployment?.runtimeEvents?.[0];
    if (!latest || redeployStatus !== "idle") return;
    setRedeployLog((latest.output || "").split("\n").filter(Boolean));
    setRunFailure(latest.error || null);
    setRunStartedAt(new Date(latest.createdAt).getTime());
    if (latest.status === "running") setRedeployStatus("deploying");
    else if (latest.status === "success") setRedeployStatus("success");
    else if (latest.status === "failed") setRedeployStatus("failed");
  }, [deployment, redeployStatus]);

  useEffect(() => {
    if (redeployStatus !== "deploying" || !runStartedAt) return;
    const update = () => setRunElapsed(Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [redeployStatus, runStartedAt]);

  useEffect(() => {
    if (redeployStatus !== "deploying" || !deployment?.legacyProjectSlug) return;
    let disposed = false;
    const reconcile = async () => {
      try {
        const response = await fetch(`/api/projects/compose/log?slug=${encodeURIComponent(deployment.legacyProjectSlug!)}`);
        if (!response.ok || disposed) return;
        const data = await readJson(response);
        setRedeployLog(Array.isArray(data.lines) ? data.lines : []);
        if (data.status === "success" || data.status === "failed") {
          setRedeployStatus(data.status);
          setRunFailure(data.status === "failed" ? data.error || "Deployment failed." : null);
          setMessage({
            tone: data.status === "success" ? "success" : "error",
            text: data.status === "success"
              ? "Deployment completed and its running images were verified."
              : data.error || "Deployment failed. Review the recorded evidence.",
          });
          await load();
        }
      } catch { /* the durable run remains active and will be retried */ }
    };
    const initial = window.setTimeout(() => void reconcile(), 600);
    const timer = window.setInterval(() => void reconcile(), 3000);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [deployment?.legacyProjectSlug, load, redeployStatus]);

  async function assignProject(projectGroupId: number | null) {
    if (!deployment) return;
    setBusy(true);
    setRedeployStatus("idle");
    try {
      const response = await fetch(`/api/projects/${deployment.id}/group`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectGroupId }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not update project");
      await load();
      setProjectOpen(false);
      setMessage({ tone: "success", text: projectGroupId ? "Deployment linked to project." : "Deployment moved to Ungrouped." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function redeploy(component?: string) {
    if (!deployment?.legacyProjectSlug) return { success: false };
    setBusy(true);
    setRunFailure(null);
    setRunStartedAt(Date.now());
    setRunElapsed(0);
    setRedeployLog(["[prepare] Deployment request accepted"]);
    setRedeployStatus("deploying");
    setShowLog(true);
    setMessage({ tone: "info", text: component ? `Redeploying ${component}…` : "Redeploying the deployment…" });
    try {
      const response = await fetch("/api/projects/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug: deployment.legacyProjectSlug,
          projectPath: deployment.sourcePath || undefined,
          composePath: deployment.composePath || undefined,
          action: "redeploy",
          services: component ? [component] : undefined,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error || data.success === false) {
        const missingEnvKeys = Array.isArray(data.missingEnvKeys)
          ? data.missingEnvKeys.filter((key: unknown): key is string => typeof key === "string")
          : [];
        setMessage({
          tone: "error",
          text: missingEnvKeys.length
            ? `Missing secrets: ${missingEnvKeys.map((k: string) => { const s = k.indexOf(":"); return s > 0 ? k.slice(s + 1) : k; }).join(", ")}`
            : data.error || "Redeploy failed",
        });
        setRunFailure(data.error || "Redeploy failed");
        setRedeployStatus("failed");
        return { success: false, missingEnvKeys };
      }

      if (data.detached) {
        setMessage({ tone: "info", text: "Deployment is running. Progress and evidence update automatically." });
        return { success: true, pending: true };
      }

      setRedeployStatus("success");
      setRunFailure(null);
      setMessage({ tone: "success", text: component ? `${component} recreated and its running image verified.` : "Deployment recreated and running images verified." });
      await load();
      return { success: true };
    } catch (error) {
      setRedeployStatus("failed");
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      setRunFailure(error instanceof Error ? error.message : String(error));
      return { success: false };
    } finally {
      setBusy(false);
    }
  }

  function openIdentityEditor() {
    setPublicUrlInput(liveUrl || "");
    setRepoUrlInput(deployment?.repoUrl || "");
    setIdentityOpen(true);
  }

  async function saveIdentity() {
    if (!deployment) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/deployment-inventory/${encodeURIComponent(deployment.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicUrl: publicUrlInput, repoUrl: repoUrlInput }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not save deployment identity");
      await load();
      setIdentityOpen(false);
      setMessage({ tone: "success", text: "Deployment identity saved." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function openComposeViewer() {
    if (!deployment?.legacyProjectSlug) return;
    setComposeLoading(true);
    setComposeOpen(true);
    try {
      const params = new URLSearchParams({ slug: deployment.legacyProjectSlug });
      if (deployment.sourcePath) params.set("path", deployment.sourcePath);
      if (deployment.composePath) params.set("composePath", deployment.composePath);
      const res = await fetch(`/api/projects/compose?${params.toString()}`);
      const data = await readJson(res);
      if (!res.ok || data.error) throw new Error(data.error || "Failed to load Compose configuration.");
      setComposeContent(data.raw || "No compose file found.");
    } catch {
      setComposeContent("Failed to load compose file.");
    } finally {
      setComposeLoading(false);
    }
  }

  async function openImageEditor(container: ContainerInfo) {
    if (!deployment?.legacyProjectSlug || !container.service) {
      setMessage({ tone: "error", text: "This container is not linked to an exact Compose service." });
      return;
    }
    setImageService(container.service);
    setImageRuntime(container.image);
    setImageConfigured("");
    setImageHasOverride(false);
    setImageSourceInput(container.image);
    setImageLoading(true);
    setImageEditorOpen(true);
    try {
      const params = new URLSearchParams({ slug: deployment.legacyProjectSlug, service: container.service });
      if (deployment.sourcePath) params.set("path", deployment.sourcePath);
      if (deployment.composePath) params.set("composePath", deployment.composePath);
      const response = await fetch(`/api/projects/compose/image?${params.toString()}`);
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not resolve the service image.");
      setImageConfigured(data.configuredImage || "");
      setImageHasOverride(Boolean(data.overrideImage));
      setImageSourceInput(data.effectiveImage || container.image);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      setImageEditorOpen(false);
    } finally {
      setImageLoading(false);
    }
  }

  async function saveImageOverride(useComposeImage = false) {
    if (!deployment?.legacyProjectSlug || !imageService) return;
    setBusy(true);
    try {
      const response = await fetch("/api/projects/compose/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug: deployment.legacyProjectSlug,
          projectPath: deployment.sourcePath || undefined,
          composePath: deployment.composePath || undefined,
          service: imageService,
          image: useComposeImage ? "" : imageSourceInput,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not save the image source.");
      setImageEditorOpen(false);
      setBusy(false);
      return await redeploy(imageService);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return { success: false };
    } finally {
      setBusy(false);
    }
  }

  const liveUrl = deployment?.publicUrl || (deployment?.domain ? `https://${deployment.domain}` : null);
  const changedFields = deployment?.releases[0]?.changedFields
    ? (() => { try { return JSON.parse(deployment.releases[0].changedFields) as string[]; } catch { return []; } })()
    : [];

  if (loading && !deployment) {
    return <div className="mx-auto max-w-7xl p-4 text-sm text-muted md:p-8">Loading deployment workspace…</div>;
  }

  if (!deployment) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Link href="/deployments" className="gc-button gc-button-quiet"><ArrowLeft size={14} />Deployments</Link>
        <Notice tone="danger" className="mt-6">{message?.text || "Deployment not found."}</Notice>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; detail: string }[] = [
    { id: "manage", label: "Manage", detail: "Containers, sources, configuration" },
    { id: "environment", label: "Environment", detail: deployment.envProfile?.name || "Configure" },
    { id: "releases", label: "Releases", detail: `${deployment.releases.length} recent` },
    { id: "deploy", label: "Deploy", detail: redeployStatus === "deploying" ? "Run active" : deployment.runtimeEvents?.[0]?.status || "Ready" },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <Link href="/deployments" className="mb-6 inline-flex items-center gap-2 text-xs text-muted hover:text-foreground">
        <ArrowLeft size={14} aria-hidden="true" />
        Deployments
      </Link>

      <header className="border-b border-border pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold tracking-[-0.04em] md:text-4xl">{deployment.name}</h1>
            <p className={`mt-2 text-xs ${deployment.observedStatus === "present" ? "text-muted" : "text-warning"}`}>
              {deployment.observedStatus === "present" ? deployment.project?.name || "Ungrouped" : "Needs attention"}
              {deployment.identitySource === "manual" && " · manually confirmed"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {deployment.repoUrl && (
              <a href={deployment.repoUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-secondary">
                <FolderGit2 size={14} aria-hidden="true" />
                Repository
              </a>
            )}
            <button type="button" onClick={openIdentityEditor} className="gc-button gc-button-secondary">
              <Pencil size={14} aria-hidden="true" />
              Edit identity
            </button>
            {liveUrl && (
              <a href={liveUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-primary">
                <ExternalLink size={14} aria-hidden="true" />
                Open live
              </a>
            )}
          </div>
        </div>
      </header>

      {message && (
        <Notice className="mt-5" tone={message.tone === "error" ? "danger" : message.tone}>{message.text}</Notice>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        <Tabs<Tab>
          label="Deployment sections"
          orientation="vertical"
          items={tabs.map((item) => ({ id: item.id, label: item.label, meta: item.detail }))}
          value={tab}
          onChange={setTab}
          className="h-fit bg-card"
        />

        <main className="min-w-0">
          {tab === "deploy" && (
            <div className="space-y-5">
              <section className="border border-border bg-card">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="p-5">
                    <p className="gc-eyebrow">Delivery</p>
                    <h2 className="mt-2 text-lg font-semibold">
                      {redeployStatus === "deploying" ? "Deployment in progress"
                        : redeployStatus === "failed" ? "Latest deployment failed"
                          : redeployStatus === "success" ? "Latest deployment verified"
                            : "Ready to deploy"}
                    </h2>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                      One recorded run resolves the live Compose target, reuses synchronized configuration, validates the workload, recreates the runtime, and verifies the public result.
                    </p>
                  </div>
                  {deployment.kind === "compose" && deployment.legacyProjectSlug && (
                    <button type="button" disabled={busy || redeployStatus === "deploying"} onClick={() => void redeploy()} className="gc-button gc-button-primary m-5">
                      <RefreshCw size={14} />{redeployStatus === "deploying" ? "Run active" : busy ? "Starting…" : "Redeploy"}
                    </button>
                  )}
                </div>
              </section>
              {redeployStatus !== "idle"
                ? <DeploymentProgress
                    status={redeployStatus}
                    lines={redeployLog}
                    failure={runFailure}
                    elapsed={runElapsed}
                    onShowLog={() => setShowLog((value) => !value)}
                    domain={deployment.domain}
                    deploymentSlug={deployment.slug}
                  />
                : <Notice tone="neutral">No active deployment run. Recorded runs are shown below.</Notice>}
              {(showLog || redeployStatus === "failed") && (redeployLog.length > 0 || runFailure) && (
                <div className="border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <span className="font-mono text-[10px] text-muted">Run evidence</span>
                    {redeployStatus !== "failed" && <button onClick={() => setShowLog(false)} className="font-mono text-[10px] text-muted">Hide</button>}
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-4 font-mono text-[10px] leading-relaxed text-muted">
                    {[...redeployLog, runFailure || ""].filter(Boolean).join("\n")}
                  </pre>
                </div>
              )}
              <section className="border border-border bg-card">
                <div className="border-b border-border px-5 py-4"><p className="gc-eyebrow">Run history</p><h2 className="mt-1 text-base font-medium">Recorded deployment activity</h2></div>
                <div className="divide-y divide-border">{(deployment.runtimeEvents || []).length > 0 ? deployment.runtimeEvents!.slice(0, 8).map((event) => <RuntimeEvent key={event.id} event={event} />) : <p className="px-5 py-6 text-xs text-muted">No deployment runs recorded.</p>}</div>
              </section>
            </div>
          )}
          {/* ===== MANAGE TAB ===== */}
          {tab === "manage" && (
            <div className="space-y-6">
              {/* Identity + Access cards */}
              <section className="grid gap-4 lg:grid-cols-2">
                <div className="border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="gc-eyebrow">Project</p>
                      <h2 className="mt-2 text-base font-medium">{deployment.project?.name || "Ungrouped"}</h2>
                      <p className="mt-1 text-xs leading-relaxed text-muted">Projects organize related deployments.</p>
                    </div>
                    <Layers3 size={18} className="text-muted" aria-hidden="true" />
                  </div>
                  <div className="mt-5 flex gap-2">
                    <button type="button" onClick={() => setProjectOpen(true)} className="gc-button gc-button-secondary">Change project</button>
                    <Link href="/projects" className="gc-button gc-button-quiet">Open projects</Link>
                  </div>
                </div>

                <div className="border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="gc-eyebrow">Access</p>
                      <h2 className="mt-2 text-base font-medium">Endpoints and source</h2>
                      <p className="mt-1 text-xs leading-relaxed text-muted">Customer-facing route and repository.</p>
                    </div>
                    <ExternalLink size={18} className="text-muted" aria-hidden="true" />
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {liveUrl ? <a href={liveUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-secondary">Open live</a> : <span className="text-xs text-muted">No public endpoint recorded.</span>}
                    {deployment.repoUrl && <a href={deployment.repoUrl} target="_blank" rel="noreferrer" className="gc-button gc-button-quiet">Repository</a>}
                  </div>
                </div>
              </section>

              {/* Management quick-actions — fixed titles */}
              <section className="border border-border bg-card p-5">
                <p className="gc-eyebrow">Management</p>
                <h2 className="mt-2 text-base font-medium">Manage deployment</h2>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <ManagementLink icon={<Box size={16} />} onClick={() => {}} title="Containers" detail="Running services below" />
                  <ManagementLink icon={<Settings2 size={16} />} onClick={() => setTab("environment")} title="Environment" detail="Configuration and secrets" />
                  <ManagementLink icon={<Activity size={16} />} onClick={() => setTab("releases")} title="Releases" detail="Changes and outcomes" />
                  <ManagementLink icon={<ServerCog size={16} />} href="/intelligence" title="Intelligence" detail="Evidence and investigation" />
                </div>
              </section>

              {/* Compose viewer + image info */}
              {deployment.kind === "compose" && (
                <section className="border border-border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="gc-eyebrow">Compose</p>
                      <h2 className="mt-1 text-base font-medium">Deployment configuration</h2>
                    </div>
                    <button type="button" onClick={openComposeViewer} className="gc-button gc-button-secondary">
                      <Code2 size={14} aria-hidden="true" />
                      View compose
                    </button>
                  </div>
                  {deployment.imageDigest && (
                    <p className="mt-3 font-mono text-[10px] text-muted truncate">
                      Current image: {deployment.imageDigest.slice(0, 47)}…
                    </p>
                  )}
                  {changedFields.length > 0 && (
                    <p className="mt-1 font-mono text-[10px] text-accent">
                      Last change: {changedFields.join(", ")}
                    </p>
                  )}
                </section>
              )}

              {/* Containers list */}
              {containers.length > 0 && (
                <section className="border border-border bg-card">
                  <div className="border-b border-border px-5 py-4">
                    <p className="gc-eyebrow">Runtime</p>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight">Containers ({containers.length})</h2>
                  </div>
                  <div className="divide-y divide-border">
                    {containers.map((container) => (
                      <div key={container.name} className="flex items-center gap-3 px-5 py-3">
                        <Link
                          href={`/containers/${encodeURIComponent(container.name)}`}
                          className="group flex min-w-0 flex-1 items-center justify-between gap-4 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <div className="min-w-0">
                            <span className="block truncate font-mono text-sm group-hover:text-accent">{container.name}</span>
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted">{container.image}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                              container.state === "running" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                            }`}>{container.state}</span>
                            <ChevronRight size={14} className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                          </div>
                        </Link>
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => openImageEditor(container)}
                            className="rounded px-2 py-1 font-mono text-[10px] text-muted hover:bg-background hover:text-foreground transition-colors"
                            title="View image source"
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Runtime events */}
              {Boolean(deployment.runtimeEvents?.length) && (
                <section className="border border-border bg-card">
                  <div className="border-b border-border px-5 py-4">
                    <p className="gc-eyebrow">Recent actions</p>
                  </div>
                  <div className="divide-y divide-border max-h-96 overflow-auto">
                    {deployment.runtimeEvents!.map((event) => (
                      <RuntimeEvent key={event.id} event={event} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ===== ENVIRONMENT TAB ===== */}
          {tab === "environment" && (
            deployment.legacyProjectId ? (
              <DeploymentEnvPanel projectId={deployment.legacyProjectId} />
            ) : (
              <div className="border border-border bg-card p-6 text-sm text-muted">Connect this deployment to a saved source before configuring environments.</div>
            )
          )}

          {/* ===== RELEASES TAB ===== */}
          {tab === "releases" && (
            <section className="border border-border bg-card">
              <div className="border-b border-border px-5 py-4">
                <p className="gc-eyebrow">Change history</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">Recent releases</h2>
              </div>
              {deployment.releases.length === 0 ? (
                <div className="p-6 text-sm text-muted">No releases recorded. Redeploy to create a release record with image digest and change tracking.</div>
              ) : (
                <div className="divide-y divide-border">
                  {deployment.releases.map((release) => (
                    <div key={release.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{release.target?.name || release.target?.type || "Deployment"}</span>
                          <span className="border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted">{release.status}</span>
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-muted">
                          {release.commitSha?.slice(0, 10) || release.branch || "No commit recorded"}
                        </p>
                        {release.imageDigest && (
                          <p className="mt-0.5 font-mono text-[9px] text-muted truncate">
                            {release.imageDigest.slice(0, 55)}…
                          </p>
                        )}
                        {release.changedFields && (() => {
                          try {
                            const fields = JSON.parse(release.changedFields) as string[];
                            return fields.length > 0 ? (
                              <span className="mt-1 inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] text-accent">
                                {fields.join(", ")}
                              </span>
                            ) : null;
                          } catch { return null; }
                        })()}
                      </div>
                      <span className="font-mono text-[10px] text-muted">{new Date(release.createdAt).toLocaleString()}</span>
                      {(release.publicUrl || release.previewUrl) && (
                        <a href={release.publicUrl || release.previewUrl || "#"} target="_blank" rel="noreferrer" className="gc-icon-button" aria-label="Open release URL">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* ===== MODALS ===== */}

      <ModalSurface open={projectOpen} onClose={() => setProjectOpen(false)} title="Change project">
        <div className="space-y-1">
          <button type="button" disabled={busy} onClick={() => void assignProject(null)} className="flex w-full items-center justify-between border border-border px-3 py-2.5 text-left text-sm hover:bg-card">
            <span>Ungrouped</span><span className="font-mono text-[10px] text-muted">No project</span>
          </button>
          {projects.map((project) => (
            <button key={project.id} type="button" disabled={busy} onClick={() => void assignProject(project.id)} className="flex w-full items-center justify-between border border-border px-3 py-2.5 text-left text-sm hover:bg-card">
              <span>{project.name}</span><span className="font-mono text-[10px] text-muted">{project.slug}</span>
            </button>
          ))}
        </div>
      </ModalSurface>

      <ModalSurface open={identityOpen} onClose={() => setIdentityOpen(false)} title="Deployment identity" description="Confirm values GroundControl cannot safely infer.">
        <form onSubmit={(event) => { event.preventDefault(); void saveIdentity(); }} className="space-y-4">
          <label className="block">
            <span className="gc-label">Deployed URL</span>
            <input autoFocus value={publicUrlInput} onChange={(event) => setPublicUrlInput(event.target.value)} placeholder="https://app.example.com" className="gc-field mt-2 w-full font-mono" />
          </label>
          <label className="block">
            <span className="gc-label">GitHub repository</span>
            <input value={repoUrlInput} onChange={(event) => setRepoUrlInput(event.target.value)} placeholder="https://github.com/owner/repository" className="gc-field mt-2 w-full font-mono" />
          </label>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setIdentityOpen(false)} className="gc-button gc-button-quiet">Cancel</button>
            <button type="submit" disabled={busy} className="gc-button gc-button-primary">{busy ? "Saving…" : "Save identity"}</button>
          </div>
        </form>
      </ModalSurface>

      <ModalSurface open={composeOpen} onClose={() => { setComposeOpen(false); setComposeContent(""); }} title="Compose file" description={deployment.sourcePath || deployment.composePath || deployment.slug}>
        {composeLoading ? (
          <div className="py-8 text-center text-sm text-muted">Loading…</div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={composeContent}
              readOnly
              className="w-full max-h-[50vh] min-h-[20vh] resize-y overflow-auto rounded border border-border bg-background p-4 font-mono text-xs whitespace-pre-wrap focus:outline-none"
              spellCheck={false}
            />
            <p className="text-[10px] leading-relaxed text-muted">
              Source Compose is read-only here. GroundControl stores image choices as a managed per-service override, so repository configuration is not silently rewritten.
            </p>
          </div>
        )}
      </ModalSurface>

      <ModalSurface open={imageEditorOpen} onClose={() => setImageEditorOpen(false)} title="Service image" description={imageService ? `Compose service · ${imageService}` : "Resolve service image"}>
        {imageLoading ? <div className="py-8 text-center text-sm text-muted">Resolving Compose image…</div> : <div className="space-y-4">
          <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
            <div className="bg-background p-3">
              <span className="gc-label">Running now</span>
              <p className="mt-1 break-all font-mono text-[10px] text-muted">{imageRuntime || "Unknown"}</p>
            </div>
            <div className="bg-background p-3">
              <span className="gc-label">Repository Compose</span>
              <p className="mt-1 break-all font-mono text-[10px] text-muted">{imageConfigured || "Build-only service"}</p>
            </div>
          </div>
          <label className="block">
            <span className="gc-label">Desired image</span>
            <input autoFocus value={imageSourceInput} onChange={(event) => setImageSourceInput(event.target.value)} placeholder="ghcr.io/owner/service:tag" className="gc-field mt-2 w-full font-mono text-xs" />
          </label>
          <p className="text-[10px] leading-relaxed text-muted">Saving validates the effective Compose model, pulls this service, forces container recreation, and verifies the running image before reporting success.</p>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setImageEditorOpen(false)} className="gc-button gc-button-quiet">Close</button>
            {imageHasOverride && <button type="button" disabled={busy} onClick={() => void saveImageOverride(true)} className="gc-button gc-button-secondary">Use Compose image</button>}
            <button type="button" disabled={busy || !imageSourceInput.trim()} onClick={() => void saveImageOverride(false)} className="gc-button gc-button-primary">
              {busy ? "Working…" : "Save and redeploy"}
            </button>
          </div>
        </div>}
      </ModalSurface>
    </div>
  );
}

function DeploymentProgress({
  status,
  lines,
  failure,
  elapsed,
  onShowLog,
  domain,
  deploymentSlug,
}: {
  status: "deploying" | "success" | "failed";
  lines: string[];
  failure?: string | null;
  elapsed: number;
  onShowLog: () => void;
  domain?: string | null;
  deploymentSlug: string;
}) {
  const progress = deploymentRunProgress(status, lines, failure);
  const intelligenceHref = (() => {
    const params = new URLSearchParams({
      deployment: deploymentSlug,
      stage: progress.failedStage || "unknown",
      error: (progress.evidence || failure || "Deployment failed.").slice(0, 600),
      autostart: "1",
    });
    if (domain) params.set("domain", domain);
    return `/intelligence?${params.toString()}`;
  })();

  return (
    <section className="border border-border bg-card" aria-live="polite">
      <div className={`border-b px-5 py-4 ${status === "failed" ? "border-error/40 bg-error/[0.035]" : "border-border"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="gc-eyebrow">Latest run</p>
            <h2 className="mt-1 text-base font-semibold">{progress.summary}</h2>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {status === "deploying" ? `${formatRunElapsed(elapsed)} elapsed` : status === "success" ? "All recorded stages completed" : progress.evidence || "The run stopped before evidence was recorded."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onShowLog} className="gc-button gc-button-quiet">
              {status === "failed" ? "Review evidence" : "View evidence"}
            </button>
            {status === "failed" && <Link href={intelligenceHref} className="gc-button gc-button-primary">Investigate failure</Link>}
          </div>
        </div>
        {status === "deploying" && (
          <div className="mt-4 h-1 overflow-hidden bg-border" aria-label={`${progress.percent || 0}% complete`}>
            <div className="h-full bg-accent motion-safe:transition-all" style={{ width: `${Math.max(8, progress.percent || 0)}%` }} />
          </div>
        )}
      </div>

      {status === "failed" && progress.evidence && (
        <div className="border-b border-error/30 bg-error/[0.025] px-5 py-4">
          <p className="font-mono text-[9px] text-error">Failure evidence</p>
          <p className="mt-2 break-words font-mono text-[10px] leading-relaxed text-foreground">{progress.evidence}</p>
        </div>
      )}

      <div className="grid divide-y divide-border sm:grid-cols-5 sm:divide-x sm:divide-y-0">
        {progress.stages.map((stage, index) => (
          <div key={stage.id} className={`relative p-4 ${
            stage.status === "failed" ? "bg-error/[0.035]"
              : stage.status === "running" ? "bg-accent/[0.04]" : ""
          }`}>
            <div className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center font-mono text-[10px] font-semibold ${
                stage.status === "complete" ? "text-success"
                  : stage.status === "failed" ? "text-error"
                    : stage.status === "running" ? "text-accent" : "text-muted"
              }`}>
                {stage.status === "complete" ? "✓" : index + 1}
              </span>
              <span className={`text-[11px] font-medium ${stage.status === "running" || stage.status === "failed" ? "text-foreground" : "text-muted"}`}>
                {stage.label}
              </span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted">{stage.detail}</p>
            <p className={`mt-2 font-mono text-[9px] ${
              stage.status === "complete" ? "text-success"
                : stage.status === "failed" ? "text-error"
                  : stage.status === "running" ? "text-accent" : "text-muted"
            }`}>
              {stage.status}
            </p>
            {stage.status === "running" && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-accent motion-safe:animate-pulse" />}
          </div>
        ))}
      </div>
    </section>
  );
}

function formatRunElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function ManagementLink({ icon, title, detail, href, onClick }: { icon: React.ReactNode; title: string; detail: string; href?: string; onClick?: () => void }) {
  const content = <><span className="mt-0.5 text-muted">{icon}</span><span><span className="block text-xs font-medium">{title}</span><span className="mt-0.5 block text-[10px] text-muted">{detail}</span></span></>;
  const className = "flex min-h-16 items-start gap-3 border border-border bg-background/40 p-3 text-left transition-colors hover:bg-background";
  if (href) return <Link href={href} className={className}>{content}</Link>;
  return <button type="button" onClick={onClick} className={className}>{content}</button>;
}

function RuntimeEvent({ event }: { event: { id: number; status: string; output?: string | null; error?: string | null; createdAt: string } }) {
  const [expanded, setExpanded] = useState(false);
  const status = event.status === "running" ? "deploying" : event.status === "success" ? "success" : "failed";
  const progress = deploymentRunProgress(status, (event.output || "").split("\n").filter(Boolean), event.error);
  const summary = progress.evidence || event.error || "Lifecycle action recorded";
  const detail = [event.error, event.output]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join("\n\n");
  const hasDetail = detail.length > summary.length || summary.length > 80;
  return (
    <div className="px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium">{progress.summary}</span>
          <p className={`mt-1 font-mono text-[9px] ${event.status === "failed" ? "text-error" : "text-muted"}`}>
            {summary}
          </p>
          {expanded && detail !== summary && (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words border-l border-border pl-3 font-mono text-[9px] leading-relaxed text-muted">
              {detail}
            </pre>
          )}
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {hasDetail && (
        <button
          type="button"
          className="mt-2 text-[10px] text-accent hover:underline"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide evidence" : "View evidence"}
        </button>
      )}
    </div>
  );
}
