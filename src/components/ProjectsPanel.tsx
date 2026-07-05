"use client";

import { useEffect, useState, useMemo } from "react";
import { ContainerIcon, getContainerType } from "@/components/TopoIcons";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { ActionConfirm } from "@/components/ActionConfirm";
import { DeploymentEnvPanel } from "@/components/DeploymentEnvPanel";
import { resolveLifecycleScope, type LifecycleAction } from "@/lib/deployment-actions";
import {
  findProjectSite,
  matchedServiceForSite,
  pathInside,
  tokensMatch,
} from "@/lib/deployment-route-match";

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
  ports?: string;
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
  environment?: string[];
  envFiles?: string[];
  labels?: string[];
  volumes?: string[];
  networks?: string[];
  dependsOn?: string[];
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
  valid?: boolean;
  parseError?: string;
  managed?: boolean;
}

interface ProjectData {
  directories: string[];
  caddySites: CaddySite[];
  scannedProjects?: ScannedProject[];
  plainDirs?: string[];
  scanError?: string | null;
  projects?: ProjectRecord[];
}

interface ProjectRecord {
  id: number;
  slug: string;
  name: string;
  domain: string | null;
  path: string;
  repoUrl: string | null;
  buildCommand: string | null;
  outputDir: string | null;
  dockerfile: string | null;
  envVars: string | null;
  category: string;
  status: string;
}

interface DeploymentTarget {
  id: number;
  name: string;
  type: string;
  vpsConfigId: number | null;
  configJson: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  vps?: { id: number; name: string } | null;
}

interface Deployment {
  id: number;
  projectId: number;
  targetId: number;
  status: string;
  branch: string;
  commitSha: string | null;
  imageTag: string | null;
  publicUrl: string | null;
  previewUrl: string | null;
  output: string | null;
  error: string | null;
  durationMs: number | null;
  envStatus?: string | null;
  envProviderType?: string | null;
  createdAt: string;
  updatedAt: string;
  project: { id: number; slug: string; name: string };
  target: DeploymentTarget;
}

type DeploymentDetailTab = "overview" | "components" | "environment" | "source" | "networking" | "storage" | "activity";
type ComponentDetailTab = "overview" | "runtime" | "environment" | "source" | "networking" | "storage" | "logs" | "actions";

interface CloudflareZone {
  id: string;
  name: string;
}

interface ComposeActionState {
  slug: string;
  type: LifecycleAction;
}

interface ConfirmComposeState {
  slug: string;
  type: ComposeActionState["type"];
  projectName: string;
}

interface ReplicateState {
  project: ScannedProject;
  newSlug: string;
  envStrategy: "copy" | "blank";
}

interface DeleteState {
  project: ScannedProject;
  deleteVolumes: boolean;
}

interface DeployOptions {
  targetId: number | "";
  branch: string;
  generatePreviewUrl: boolean;
  subdomain: string;
  zoneId: string;
  proxied: boolean;
  replicas: number;
  port: number;
  ingressClass: "traefik" | "caddy";
  projectId: string;
  region: string;
  serviceName: string;
  cpu: number;
  memory: string;
  concurrency: number;
  maxInstances: number;
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

function statusColor(status: string): string {
  switch (status) {
    case "success":
      return "bg-success/10 text-success";
    case "failed":
    case "rolled_back":
      return "bg-error/10 text-error";
    case "running":
    case "building":
    case "deploying":
      return "bg-accent/10 text-accent";
    default:
      return "bg-warning/10 text-warning";
  }
}

export function ProjectsPanel() {
  const [data, setData] = useState<ProjectData | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [composeAction, setComposeAction] = useState<ComposeActionState | null>(null);
  const [composeOutput, setComposeOutput] = useState<{ slug: string; output: string; error?: string } | null>(null);
  const [selectedServices, setSelectedServices] = useState<Record<string, Set<string>>>({});
  const [confirmCompose, setConfirmCompose] = useState<ConfirmComposeState | null>(null);
  const [adoptedProjects, setAdoptedProjects] = useState<Record<string, ProjectRecord>>({});
  const [detailState, setDetailState] = useState<{ slug: string; tab: DeploymentDetailTab } | null>(null);
  const [componentState, setComponentState] = useState<{ projectSlug: string; serviceName: string; tab: ComponentDetailTab } | null>(null);
  const [redeploySlug, setRedeploySlug] = useState<string | null>(null);
  const [replicateState, setReplicateState] = useState<ReplicateState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const [redeployAdvancedOpen, setRedeployAdvancedOpen] = useState(false);

  const [targets, setTargets] = useState<DeploymentTarget[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [zones, setZones] = useState<CloudflareZone[]>([]);
  const [deployOptions, setDeployOptions] = useState<Record<string, DeployOptions>>({});

  const defaultTargetId = useMemo(() => {
    const active = targets.find((t) => t.isActive);
    if (active) return active.id;
    return targets[0]?.id || "";
  }, [targets]);

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => safeJson(r)),
      fetch("/api/containers").then((r) => safeJson(r)),
      fetch("/api/docker-images").then((r) => safeJson(r)),
      fetch("/api/deployment-targets")
        .then((r) => safeJson(r))
        .catch(() => ({ ok: true, data: [], text: "" })),
      fetch("/api/deployments")
        .then((r) => safeJson(r))
        .catch(() => ({ ok: true, data: [], text: "" })),
      fetch("/api/cloudflare/zones")
        .then((r) => safeJson(r))
        .catch(() => ({ ok: true, data: { success: false, result: [] }, text: "" })),
    ])
      .then(([projectsRes, containersRes, imagesRes, targetsRes, deploymentsRes, zonesRes]) => {
        setData(projectsRes.data);
        setContainers(Array.isArray(containersRes.data) ? containersRes.data : []);
        setImages(Array.isArray(imagesRes.data) ? imagesRes.data : []);
        if (projectsRes.data?.scanError) setError(`Scan warning: ${projectsRes.data.scanError}`);

        const loadedTargets: DeploymentTarget[] = Array.isArray(targetsRes.data) ? targetsRes.data : [];
        setTargets(loadedTargets);

        const loadedDeployments: Deployment[] = Array.isArray(deploymentsRes.data) ? deploymentsRes.data : [];
        setDeployments(loadedDeployments);

        const zoneResult = zonesRes.data?.result;
        setZones(Array.isArray(zoneResult) ? zoneResult : []);
        const activeTarget = loadedTargets.find((t) => t.isActive) || loadedTargets[0];
        const initialOptions: Record<string, DeployOptions> = {};
        for (const p of projectsRes.data?.scannedProjects || []) {
          initialOptions[p.slug] = {
            targetId: activeTarget?.id || "",
            branch: "main",
            generatePreviewUrl: false,
            subdomain: p.domain || "",
            zoneId: "",
            proxied: true,
            replicas: 1,
            port: 80,
            ingressClass: "traefik",
            projectId: "",
            region: "us-central1",
            serviceName: p.slug,
            cpu: 1,
            memory: "512Mi",
            concurrency: 80,
            maxInstances: 5,
          };
        }
        setDeployOptions(initialOptions);

        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  async function refreshDeployments() {
    try {
      const res = await fetch("/api/deployments");
      const { data } = await safeJson(res);
      setDeployments(Array.isArray(data) ? data : []);
    } catch {
      // ignore refresh errors
    }
  }

  function getDbProject(slug: string): ProjectRecord | undefined {
    return adoptedProjects[slug] || data?.projects?.find((p) => p.slug === slug);
  }

  function getLatestDeployment(projectId?: number): Deployment | undefined {
    if (!projectId) return undefined;
    return deployments
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }

  function getDeployOptions(slug: string): DeployOptions {
    return (
      deployOptions[slug] || {
        targetId: defaultTargetId,
        branch: "main",
        generatePreviewUrl: false,
        subdomain: "",
        zoneId: "",
        proxied: true,
        replicas: 1,
        port: 80,
        ingressClass: "traefik",
        projectId: "",
        region: "us-central1",
        serviceName: slug,
        cpu: 1,
        memory: "512Mi",
        concurrency: 80,
        maxInstances: 5,
      }
    );
  }

  function updateDeployOptions(slug: string, patch: Partial<DeployOptions>) {
    setDeployOptions((prev) => ({
      ...prev,
      [slug]: { ...getDeployOptions(slug), ...patch },
    }));
  }

  async function triggerDeploy(slug: string) {
    const dbProject = getDbProject(slug);
    if (!dbProject) {
      setError(`Project ${slug} is not registered in the database.`);
      return;
    }

    const opts = getDeployOptions(slug);
    const selectedTarget = targets.find((t) => t.id === opts.targetId);
    const activeTarget = targets.find((t) => t.isActive);
    const target = selectedTarget || activeTarget;
    const isK3s = target?.type === "k3s";
    const isCloudRun = target?.type === "cloudrun";
    const isTerraform = target?.type === "terraform";
    setDeploying(slug);
    try {
      if (isTerraform && target) {
        let stackId: string | number | undefined;
        try {
          const cfg = JSON.parse(target.configJson || "{}");
          stackId = cfg.stackId;
        } catch {
          stackId = undefined;
        }
        if (!stackId) {
          setError(`Terraform target ${target.name} has no stack configured.`);
          return;
        }
        const provisionRes = await fetch("/api/terraform/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: dbProject.id, stackId }),
        });
        const { ok: provOk, data: provData } = await safeJson(provisionRes);
        if (!provOk || provData.error) {
          setError(`Terraform provision failed: ${provData.error || "Unknown error"}`);
          return;
        }
      }

      const body: Record<string, unknown> = {
        projectSlug: slug,
        branch: opts.branch || "main",
      };
      if (opts.targetId) body.targetId = opts.targetId;
      if (opts.generatePreviewUrl) body.generatePreviewUrl = true;
      if (opts.subdomain && opts.zoneId) {
        body.subdomain = opts.subdomain;
        body.zoneId = opts.zoneId;
        body.proxied = opts.proxied;
      }
      if (isK3s) {
        body.replicas = opts.replicas;
        body.port = opts.port;
        body.ingressClass = opts.ingressClass;
      }
      if (isCloudRun) {
        if (opts.projectId) body.projectId = opts.projectId;
        if (opts.region) body.region = opts.region;
        if (opts.serviceName) body.serviceName = opts.serviceName;
        if (opts.cpu) body.cpu = opts.cpu;
        if (opts.memory) body.memory = opts.memory;
        if (opts.concurrency) body.concurrency = opts.concurrency;
        if (opts.maxInstances) body.maxInstances = opts.maxInstances;
      }

      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) setError(`Deploy failed: ${data.error || "Unknown error"}`);
      else {
        setError("");
        await refreshDeployments();
      }
    } catch (err) {
      setError(`Deploy failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeploying(null);
    }
  }

  async function runCompose(slug: string, type: LifecycleAction, services?: string[]) {
    setComposeAction({ slug, type });
    setComposeOutput(null);
    try {
      const endpoint = type === "stop" ? "/api/projects/compose-down" : "/api/projects/compose";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, services, action: type }),
      });
      const { ok, data } = await safeJson(res);
      const failed = !ok || (data.success === false && data.error);
      const label = type === "start" ? "Start" : type === "stop" ? "Stop" : type === "redeploy" ? "Redeploy" : "Restart";
      if (failed) {
        setError(`${label} failed: ${data.error || "Unknown error"}`);
        setComposeOutput({ slug, output: data.output || "", error: data.error });
      } else {
        setError("");
        const output = data.output || data.stderr || `${label} completed`;
        setComposeOutput({ slug, output, error: "" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const label = type === "start" ? "Start" : type === "stop" ? "Stop" : type === "redeploy" ? "Redeploy" : "Restart";
      setError(`${label} failed: ${message}`);
      setComposeOutput({ slug, output: "", error: message });
    } finally {
      setComposeAction(null);
      setConfirmCompose(null);
    }
  }

  async function replicateDeployment(project: ScannedProject) {
    setReplicateState({ project, newSlug: `${project.slug}-copy`, envStrategy: "blank" });
  }

  async function performReplicate() {
    if (!replicateState?.newSlug.trim()) return;
    const { project, newSlug, envStrategy } = replicateState;
    setReplicateState(null);
    setComposeOutput({ slug: project.slug, output: "Creating isolated deployment copy..." });
    try {
      const res = await fetch("/api/deployments/replicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: project.path,
          sourceSlug: project.slug,
          newSlug,
          envStrategy,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setComposeOutput({ slug: project.slug, output: "", error: data.error || "Replication failed" });
        setError(`Replication failed: ${data.error || "Unknown error"}`);
      } else {
        setError("");
        setComposeOutput({ slug: project.slug, output: data.message || `Created ${data.targetPath}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setComposeOutput({ slug: project.slug, output: "", error: message });
      setError(`Replication failed: ${message}`);
    }
  }

  async function deleteManagedDeployment(project: ScannedProject) {
    if (!project.path) {
      setError("No deployment path found for this project.");
      return;
    }
    setDeleteState({ project, deleteVolumes: false });
  }

  async function performDelete() {
    if (!deleteState) return;
    const { project, deleteVolumes } = deleteState;
    setDeleteState(null);
    setComposeOutput({ slug: project.slug, output: "Deleting deployment..." });
    try {
      const res = await fetch("/api/deployments/delete-managed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: project.path, deleteVolumes, force: !project.managed }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error) {
        setComposeOutput({ slug: project.slug, output: "", error: data.error || "Delete failed" });
        setError(`Delete failed: ${data.error || "Unknown error"}`);
      } else {
        setError("");
        setComposeOutput({ slug: project.slug, output: data.output || `Deleted ${project.path}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setComposeOutput({ slug: project.slug, output: "", error: message });
      setError(`Delete failed: ${message}`);
    }
  }

  async function ensureProjectRecord(project: ScannedProject): Promise<ProjectRecord | null> {
    const existing = getDbProject(project.slug);
    if (existing) return existing;
    setError("");
    try {
      const res = await fetch("/api/projects/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: project.slug,
          name: project.name,
          path: project.path,
          composePath: project.composePath,
          domain: project.domain || "",
          hasGit: project.hasGit,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || data.error || !data.project) {
        setError(`Adopt failed: ${data.error || "Unknown error"}`);
        return null;
      }
      const adopted = data.project as ProjectRecord;
      setAdoptedProjects((prev) => ({ ...prev, [project.slug]: adopted }));
      return adopted;
    } catch (err) {
      setError(`Adopt failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async function openDeploymentDetail(project: ScannedProject, tab: DeploymentDetailTab) {
    if (tab === "environment") {
      await ensureProjectRecord(project);
    }
    setDetailState({ slug: project.slug, tab });
  }

  function closeAllSheets() {
    setDetailState(null);
    setComponentState(null);
    setRedeploySlug(null);
    setReplicateState(null);
    setDeleteState(null);
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

  if (loading) {
    return <LoaderOverlay3D open={loading} variant="project" title="Loading projects..." />;
  }

  return (
    <div className="space-y-6 relative">
      <LoaderOverlay3D
        open={!!composeAction}
        variant="compose"
        title={composeAction ? `${composeAction.type === "start" ? "Starting" : composeAction.type === "stop" ? "Stopping" : composeAction.type === "redeploy" ? "Redeploying" : "Restarting"} deployment...` : "Updating deployment..."}
      />
      <LoaderOverlay3D
        open={!!deploying}
        variant="deploy"
        title={deploying ? `Deploying ${deploying}...` : "Deploying..."}
      />
      {error && (
        <div className="mb-4 p-3 bg-error/10 rounded-lg text-error text-xs font-mono flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:text-foreground">✕</button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="bg-card rounded-xl p-6 text-muted text-sm">
          No deployments found yet.
        </div>
      ) : (
        <div className="space-y-4">
              {projects.map((project) => {
                const meta = projectMeta.get(project.slug) || { containers: [], images: [] };
                const running = meta.containers.filter((c) => c.state === "running").length;
                const stopped = meta.containers.filter((c) => c.state !== "running").length;
                const site = findProjectSite(project, data?.caddySites, meta.containers);
                const dbProject = getDbProject(project.slug);
                const latest = getLatestDeployment(dbProject?.id);
                const opts = getDeployOptions(project.slug);
                const selectedTarget = targets.find((t) => t.id === opts.targetId);
                const isK3s = selectedTarget?.type === "k3s";
                const isCloudRun = selectedTarget?.type === "cloudrun";
                const isTerraform = selectedTarget?.type === "terraform";
                const selectedTargetName = selectedTarget?.name || "default";
                const isInvalid = project.valid === false || !!project.parseError;

                return (
                  <div
                    key={project.slug}
                    className="bg-card rounded-xl p-5 transition-colors hover:bg-card/80"
                  >
                    <div className="flex flex-col gap-4 mb-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-medium text-lg">{project.name}</h3>
                          <span className="text-[10px] font-mono text-muted bg-border/50 px-1.5 py-0.5 rounded">
                            {project.slug}
                          </span>
                          {project.hasGit && (
                            <span className="text-[10px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                              branch
                            </span>
                          )}
                          {isInvalid && (
                            <span className="text-[10px] font-mono text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                              invalid compose
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
                          <p className="text-xs text-muted font-mono mt-1">No route detected yet</p>
                        )}
                        {latest && (latest.publicUrl || latest.previewUrl) && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {latest.publicUrl && (
                              <a
                                href={latest.publicUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded bg-success/10 text-success hover:bg-success/20 transition-colors"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                                {latest.publicUrl}
                              </a>
                            )}
                            {latest.previewUrl && (
                              <a
                                href={latest.previewUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                                preview
                              </a>
                            )}
                            {latest.status && (
                              <span className={`text-[10px] font-mono px-2 py-1 rounded ${statusColor(latest.status)}`}>
                                {latest.status}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-start gap-2 self-start">
                        {!isInvalid && (
                          running > 0 ? (
                            <button
                              onClick={() => {
                                setRedeployAdvancedOpen(false);
                                setRedeploySlug(project.slug);
                              }}
                              disabled={deploying === project.slug}
                              className="rounded-lg bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                              title="Run the full deployment pipeline"
                            >
                              Redeploy
                            </button>
                          ) : (
                            <button
                              onClick={() => setConfirmCompose({ slug: project.slug, type: "start", projectName: project.name })}
                              disabled={!!composeAction}
                              className="rounded-lg bg-success/10 px-3 py-2 text-xs font-mono text-success transition-colors hover:bg-success/20 disabled:opacity-50"
                              title="Start the deployment or selected services"
                            >
                              Start
                            </button>
                          )
                        )}
                        <div className="relative">
                          {openActionMenu === project.slug && (
                            <button
                              aria-label="Close deployment actions"
                              className="fixed inset-0 z-20 cursor-default bg-transparent"
                              onClick={() => setOpenActionMenu(null)}
                            />
                          )}
                          <button
                            onClick={() => setOpenActionMenu(openActionMenu === project.slug ? null : project.slug)}
                            className="relative z-30 flex h-9 w-9 items-center justify-center rounded-lg bg-background text-lg leading-none text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                            title="Deployment actions"
                            aria-label={`Actions for ${project.name}`}
                          >
                            ⋮
                          </button>
                            {openActionMenu === project.slug && <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-lg bg-card shadow-xl shadow-black/20">
                            <button
                              onClick={() => {
                                setOpenActionMenu(null);
                                openDeploymentDetail(project, "overview");
                              }}
                              className="block w-full px-3 py-2 text-left text-xs font-mono text-muted transition-colors hover:bg-background hover:text-accent"
                              title="Open deployment details"
                            >
                              Details
                            </button>
                            {!isInvalid && (
                              <>
                                <button
                                  onClick={() => {
                                    setOpenActionMenu(null);
                                    setConfirmCompose({ slug: project.slug, type: "stop", projectName: project.name });
                                  }}
                                  disabled={!!composeAction}
                                  className="block w-full px-3 py-2 text-left text-xs font-mono text-warning transition-colors hover:bg-warning/10 disabled:opacity-50"
                                  title="Stop the deployment or selected services"
                                >
                                  Stop
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenActionMenu(null);
                                    setConfirmCompose({ slug: project.slug, type: "restart", projectName: project.name });
                                  }}
                                  disabled={!!composeAction}
                                  className="block w-full px-3 py-2 text-left text-xs font-mono text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
                                  title="Restart the deployment or selected services"
                                >
                                  Restart
                                </button>
                              </>
                            )}
                            <button
                              onClick={async () => {
                                setOpenActionMenu(null);
                                await openDeploymentDetail(project, "environment");
                              }}
                              className="block w-full px-3 py-2 text-left text-xs font-mono text-muted transition-colors hover:bg-background hover:text-accent"
                              title="Manage deployment environment"
                            >
                              Environment
                            </button>
                            <button
                              onClick={() => {
                                setOpenActionMenu(null);
                                replicateDeployment(project);
                              }}
                              disabled={!!composeAction}
                              className="block w-full px-3 py-2 text-left text-xs font-mono text-muted transition-colors hover:bg-background hover:text-accent disabled:opacity-50"
                              title="Replicate deployment"
                            >
                              Replicate
                            </button>
                            <button
                              onClick={() => {
                                setOpenActionMenu(null);
                                deleteManagedDeployment(project);
                              }}
                              disabled={!!composeAction}
                              className="block w-full px-3 py-2 text-left text-xs font-mono text-error transition-colors hover:bg-error/10 disabled:opacity-40"
                              title="Delete deployment"
                            >
                              Delete
                            </button>
                          </div>}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[10px] font-mono text-muted">
                      <button
                        onClick={() => openDeploymentDetail(project, "components")}
                        className="rounded bg-background/50 px-2 py-1 hover:bg-accent/10 hover:text-accent"
                      >
                        {project.services.length} component{project.services.length === 1 ? "" : "s"}
                      </button>
                      <button
                        onClick={async () => {
                          await openDeploymentDetail(project, "environment");
                        }}
                        className="rounded bg-background/50 px-2 py-1 hover:bg-accent/10 hover:text-accent"
                      >
                        Env {latest?.envStatus || "unknown"}
                      </button>
                      <button
                        onClick={() => openDeploymentDetail(project, "overview")}
                        className="rounded bg-background/50 px-2 py-1 hover:bg-accent/10 hover:text-accent"
                      >
                        Details
                      </button>
                    </div>

                    {composeOutput?.slug === project.slug && composeOutput.error && (
                      <div className="mt-3 rounded bg-error/5 p-2 text-[10px] font-mono text-error">
                        Action failed. Open Activity for output.
                      </div>
                    )}

                    {detailState?.slug === project.slug && (
                      <div className="fixed inset-0 z-[70] flex justify-end bg-black/70" onMouseDown={closeAllSheets}>
                        <div className="flex h-full w-full max-w-5xl flex-col bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                          <div className="flex items-start justify-between gap-4 p-5">
                            <div className="min-w-0">
                              <h2 className="truncate text-xl font-semibold">{project.name}</h2>
                              <p className="mt-1 text-xs font-mono text-muted">
                                {site?.domain || project.domain || "No route detected yet"} · {running} running · {project.services.length} components
                              </p>
                            </div>
                            <button
                              onClick={() => setDetailState(null)}
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-background hover:text-accent"
                              title="Close"
                              aria-label="Close deployment details"
                            >
                              <CloseIcon />
                            </button>
                          </div>

                          <div className="flex gap-1 overflow-x-auto px-5 pt-3">
                            {(["overview", "components", "environment", "source", "networking", "storage", "activity"] as DeploymentDetailTab[]).map((tab) => (
                              <button
                                key={tab}
                                onClick={() => openDeploymentDetail(project, tab)}
                                className={`shrink-0 rounded px-3 py-2 text-xs font-mono capitalize transition-colors ${
                                  detailState.tab === tab ? "bg-accent/10 text-accent" : "text-muted hover:bg-background hover:text-foreground"
                                }`}
                              >
                                {tab}
                              </button>
                            ))}
                          </div>

                          <div className="flex-1 overflow-auto p-5">
                            {detailState.tab === "overview" && (
                              <div className="grid gap-3 md:grid-cols-3">
                                <InfoTile label="Status" value={isInvalid ? "Invalid compose" : running > 0 ? "Running" : "Stopped"} />
                                <InfoTile label="Route" value={site?.domain || project.domain || "No route detected yet"} />
                                <InfoTile label="Environment" value={latest?.envStatus || "unknown"} />
                                <InfoTile label="Components" value={String(project.services.length)} />
                                <InfoTile label="Containers" value={`${running} running, ${stopped} stopped`} />
                                <InfoTile label="Last deploy" value={latest?.status || "No deployment record"} />
                              </div>
                            )}

                            {detailState.tab === "components" && (
                              <div className="space-y-3">
                                {isInvalid ? (
                                  <div className="rounded-lg bg-warning/5 p-3 text-xs text-warning">
                                    {project.parseError || "Compose file is invalid"}
                                  </div>
                                ) : project.services.length === 0 ? (
                                  <div className="rounded-lg bg-warning/5 p-3 text-xs text-warning">
                                    No parseable components found.
                                  </div>
                                ) : (
                                  project.services.map((svc) => {
                                    const checked = isServiceSelected(project.slug, svc.name);
                                    return (
                                      <button
                                        key={svc.name}
                                        onClick={() => setComponentState({ projectSlug: project.slug, serviceName: svc.name, tab: "overview" })}
                                        className="flex w-full items-center justify-between gap-3 rounded-lg bg-card p-3 text-left transition-colors hover:bg-background"
                                      >
                                        <span className="flex min-w-0 items-center gap-3">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onClick={(event) => event.stopPropagation()}
                                            onChange={() => toggleService(project.slug, svc.name)}
                                            className="shrink-0 accent-accent"
                                          />
                                          <ContainerIcon className="h-4 w-4 text-muted" type={getContainerType(svc.name, svc.image || "")} />
                                          <span className="truncate text-sm font-mono">{svc.name}</span>
                                        </span>
                                        <span className="text-[10px] font-mono text-muted">Details</span>
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            )}

                            {detailState.tab === "environment" && (
                              dbProject ? (
                                project.services.length > 0 ? (
                                  <div className="space-y-3">
                                    {project.services.map((svc) => (
                                      <button
                                        key={svc.name}
                                        onClick={() => setComponentState({ projectSlug: project.slug, serviceName: svc.name, tab: "environment" })}
                                        className="flex w-full items-center justify-between rounded-lg bg-card p-3 text-left transition-colors hover:bg-background"
                                      >
                                        <span>
                                          <span className="block text-sm font-mono">{svc.name}</span>
                                          <span className="mt-1 block text-[10px] font-mono text-muted">
                                            {(svc.environment?.length || 0) + (svc.envFiles?.length || 0)} env source{((svc.environment?.length || 0) + (svc.envFiles?.length || 0)) === 1 ? "" : "s"}
                                          </span>
                                        </span>
                                        <span className="text-[10px] font-mono text-muted">Edit env</span>
                                      </button>
                                    ))}
                                  </div>
                                ) : (
                                  <DeploymentEnvPanel
                                    projectId={dbProject.id}
                                    deploymentId={latest?.id}
                                    onRedeploy={() => {
                                      setRedeployAdvancedOpen(false);
                                      setRedeploySlug(project.slug);
                                    }}
                                  />
                                )
                              ) : (
                                <div className="rounded-lg bg-card p-3 text-xs text-muted">
                                  Preparing environment source...
                                </div>
                              )
                            )}

                            {detailState.tab === "source" && (
                              <div className="grid gap-3 md:grid-cols-2">
                                <InfoTile label="Repository" value={dbProject?.repoUrl || (project.hasGit ? "Git repository on server" : "No repository detected")} />
                                <InfoTile label="Branch" value={opts.branch || "main"} />
                                <InfoTile label="Compose file" value={project.composePath} />
                                <InfoTile label="Deployment path" value={project.path} />
                              </div>
                            )}

                            {detailState.tab === "networking" && (
                              <div className="grid gap-3 md:grid-cols-2">
                                <InfoTile label="Domain" value={site?.domain || project.domain || "No route detected yet"} />
                                <InfoTile label="Proxy target" value={site?.proxy || "No proxy target detected"} />
                                <InfoTile label="Matched service" value={site ? matchedServiceForSite(site, project, meta.containers) : "No route detected yet"} />
                                <InfoTile label="Config file" value={site?.file || "No proxy file detected"} />
                                <InfoTile label="DNS zone" value={opts.zoneId ? zones.find((z) => z.id === opts.zoneId)?.name || opts.zoneId : "No zone selected"} />
                                <InfoTile label="Public route" value={latest?.publicUrl || latest?.previewUrl || "No public URL"} />
                              </div>
                            )}

                            {detailState.tab === "storage" && (
                              <div className="grid gap-3 md:grid-cols-2">
                                <InfoTile label="Containers" value={`${meta.containers.length} linked`} />
                                <InfoTile label="Images" value={`${meta.images.length} linked`} />
                                <InfoTile label="Volumes" value="Volume inventory not attached yet" />
                                <InfoTile label="Data policy" value="Volumes are preserved by default" />
                              </div>
                            )}

                            {detailState.tab === "activity" && (
                              <div className="space-y-3">
                                <InfoTile label="Latest status" value={latest?.status || "No deployment record"} />
                                {composeOutput?.slug === project.slug && (
                                  <pre className="max-h-72 overflow-auto rounded-lg bg-card p-3 text-xs whitespace-pre-wrap">
                                    {composeOutput.error || composeOutput.output || "No output"}
                                  </pre>
                                )}
                                {latest?.output && (
                                  <pre className="max-h-72 overflow-auto rounded-lg bg-card p-3 text-xs whitespace-pre-wrap">
                                    {latest.output}
                                  </pre>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {componentState?.projectSlug === project.slug && (() => {
                      const svc = project.services.find((service) => service.name === componentState.serviceName);
                      if (!svc) return null;
                      const existing = meta.containers.find(
                        (c) => tokensMatch(c.composeService || "", svc.name) || c.name.toLowerCase().includes(svc.name.toLowerCase())
                      );
                      return (
                        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setComponentState(null)}>
                          <div className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-xl bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                            <div className="flex items-start justify-between p-4">
                              <div>
                                <h3 className="text-lg font-semibold">{svc.name}</h3>
                                <p className="mt-1 text-xs font-mono text-muted">{existing?.state || "not running"}</p>
                              </div>
                              <button
                                onClick={() => setComponentState(null)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-accent"
                                title="Close"
                                aria-label="Close component details"
                              >
                                <CloseIcon />
                              </button>
                            </div>
                            <div className="flex gap-1 overflow-x-auto px-4 pt-2">
                              {(["overview", "runtime", "environment", "source", "networking", "storage", "logs", "actions"] as ComponentDetailTab[]).map((tab) => (
                                <button
                                  key={tab}
                                  onClick={() => setComponentState({ projectSlug: project.slug, serviceName: svc.name, tab })}
                                  className={`shrink-0 rounded px-3 py-2 text-xs font-mono capitalize ${
                                    componentState.tab === tab ? "bg-accent/10 text-accent" : "text-muted hover:bg-card hover:text-foreground"
                                  }`}
                                >
                                  {tab}
                                </button>
                              ))}
                            </div>
                            <div className="overflow-auto p-4">
                              {componentState.tab === "overview" && (
                                <div className="grid gap-3 md:grid-cols-2">
                                  <InfoTile label="Service" value={svc.name} />
                                  <InfoTile label="State" value={existing?.state || "not created"} />
                                </div>
                              )}
                              {componentState.tab === "runtime" && (
                                <div className="grid gap-3 md:grid-cols-2">
                                  <InfoTile label="Container" value={existing?.name || "No linked container"} />
                                  <InfoTile label="Status" value={existing?.status || "not running"} />
                                </div>
                              )}
                              {componentState.tab === "environment" && (
                                <div className="space-y-3">
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <InfoTile label="Service env keys" value={svc.environment?.join(", ") || "No service-specific env declared"} />
                                    <InfoTile label="Env files" value={svc.envFiles?.join(", ") || "No env file declared"} />
                                  </div>
                                  {dbProject && (
                                    <DeploymentEnvPanel
                                      projectId={dbProject.id}
                                      deploymentId={latest?.id}
                                      componentName={svc.name}
                                      onRedeploy={() => runCompose(project.slug, "redeploy", [svc.name])}
                                    />
                                  )}
                                </div>
                              )}
                              {componentState.tab === "source" && (
                                <div className="grid gap-3 md:grid-cols-2">
                                  <InfoTile label="Image" value={svc.image || "No image declared"} />
                                  <InfoTile label="Build" value={svc.build ? "Build context declared" : "No build context"} />
                                </div>
                              )}
                              {componentState.tab === "networking" && (
                                <div className="grid gap-3 md:grid-cols-2">
                                  <InfoTile label="Ports" value={svc.ports?.join(", ") || "No ports declared"} />
                                  <InfoTile label="Networks" value={svc.networks?.join(", ") || "Default compose network"} />
                                </div>
                              )}
                              {componentState.tab === "storage" && <InfoTile label="Volumes" value={svc.volumes?.join(", ") || "No volumes declared"} />}
                              {componentState.tab === "logs" && <InfoTile label="Logs" value={existing ? "Open Containers to stream logs" : "No linked container"} />}
                              {componentState.tab === "actions" && (
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => {
                                      setSelectedServices((prev) => ({ ...prev, [project.slug]: new Set([svc.name]) }));
                                      runCompose(project.slug, "redeploy", [svc.name]);
                                    }}
                              className="rounded bg-accent/10 px-3 py-2 text-xs font-mono text-accent"
                                    title="Recreate this service with the saved environment."
                                  >
                                    Redeploy component <span aria-hidden="true" className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px]">i</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {redeploySlug === project.slug && (
                      <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setRedeploySlug(null)}>
                        <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-xl bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                          <div className="flex items-start justify-between p-5">
                            <div>
                              <h2 className="text-xl font-semibold">Redeploy {project.name}</h2>
                              <p className="mt-1 text-xs font-mono text-muted">
                                Runs saved environment, source or image refresh, migrations, proxy reload, and health checks when configured.
                              </p>
                            </div>
                            <button
                              onClick={() => setRedeploySlug(null)}
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-accent"
                              title="Close"
                              aria-label="Close redeploy"
                            >
                              <CloseIcon />
                            </button>
                          </div>
                          <div className="space-y-4 p-5">
                            <div className="rounded-lg bg-card p-3 text-xs font-mono text-muted">
                              Component redeploys live in component details. This action redeploys the whole deployment.
                            </div>
                            <button
                              type="button"
                              onClick={() => setRedeployAdvancedOpen((open) => !open)}
                              className="rounded bg-card px-3 py-2 text-xs font-mono text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                            >
                              {redeployAdvancedOpen ? "Hide" : "Show"} advanced target settings
                            </button>

                            {redeployAdvancedOpen && (
                            <div className="grid gap-3 rounded-lg bg-card p-3 md:grid-cols-3">
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-mono text-muted">Target</span>
                                <select
                                  value={opts.targetId}
                                  onChange={(e) => updateDeployOptions(project.slug, { targetId: e.target.value ? Number(e.target.value) : "" })}
                                  className="w-full rounded-lg bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
                                >
                                  <option value="">Active target</option>
                                  {targets.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
                                </select>
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-mono text-muted">Branch</span>
                                <input
                                  value={opts.branch}
                                  onChange={(e) => updateDeployOptions(project.slug, { branch: e.target.value })}
                                  className="w-full rounded-lg bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
                                />
                              </label>
                              <label className="flex items-center gap-2 pt-5 text-xs font-mono text-muted">
                                <input
                                  type="checkbox"
                                  checked={opts.generatePreviewUrl}
                                  onChange={(e) => updateDeployOptions(project.slug, { generatePreviewUrl: e.target.checked })}
                                  className="accent-accent"
                                />
                                Create preview URL
                              </label>
                            </div>
                            )}

                            {redeployAdvancedOpen && isK3s && (
                              <div className="grid gap-3 md:grid-cols-3">
                                <NumberInput label="Replicas" value={opts.replicas} onChange={(value) => updateDeployOptions(project.slug, { replicas: Math.max(1, value) })} />
                                <NumberInput label="Port" value={opts.port} onChange={(value) => updateDeployOptions(project.slug, { port: Math.max(1, value) })} />
                                <label className="block">
                                  <span className="mb-1 block text-[10px] font-mono text-muted">Ingress class</span>
                                  <select
                                    value={opts.ingressClass}
                                    onChange={(e) => updateDeployOptions(project.slug, { ingressClass: e.target.value as "traefik" | "caddy" })}
                                    className="w-full rounded-lg bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
                                  >
                                    <option value="traefik">Traefik</option>
                                    <option value="caddy">Caddy</option>
                                  </select>
                                </label>
                              </div>
                            )}

                            {redeployAdvancedOpen && isCloudRun && (
                              <div className="grid gap-3 md:grid-cols-3">
                                <TextInput label="GCP project" value={opts.projectId} onChange={(value) => updateDeployOptions(project.slug, { projectId: value })} />
                                <TextInput label="Region" value={opts.region} onChange={(value) => updateDeployOptions(project.slug, { region: value })} />
                                <TextInput label="Service name" value={opts.serviceName} onChange={(value) => updateDeployOptions(project.slug, { serviceName: value })} />
                                <NumberInput label="CPU" value={opts.cpu} onChange={(value) => updateDeployOptions(project.slug, { cpu: Math.max(1, value) })} />
                                <TextInput label="Memory" value={opts.memory} onChange={(value) => updateDeployOptions(project.slug, { memory: value })} />
                                <NumberInput label="Max instances" value={opts.maxInstances} onChange={(value) => updateDeployOptions(project.slug, { maxInstances: Math.max(1, value) })} />
                              </div>
                            )}

                            {redeployAdvancedOpen && zones.length > 0 && (
                              <div className="grid gap-3 md:grid-cols-3">
                                <TextInput label="Subdomain" value={opts.subdomain} onChange={(value) => updateDeployOptions(project.slug, { subdomain: value })} />
                                <label className="block">
                                  <span className="mb-1 block text-[10px] font-mono text-muted">Zone</span>
                                  <select
                                    value={opts.zoneId}
                                    onChange={(e) => updateDeployOptions(project.slug, { zoneId: e.target.value })}
                                    className="w-full rounded-lg bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
                                  >
                                    <option value="">Select zone</option>
                                    {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                                  </select>
                                </label>
                                <label className="flex items-center gap-2 pt-5 text-xs font-mono text-muted">
                                  <input type="checkbox" checked={opts.proxied} onChange={(e) => updateDeployOptions(project.slug, { proxied: e.target.checked })} className="accent-accent" />
                                  Proxied
                                </label>
                              </div>
                            )}

                            {redeployAdvancedOpen && <div className="rounded-lg bg-card p-3 text-xs font-mono text-muted">
                              Target: {selectedTargetName}
                              {isTerraform && " · Terraform apply first"}
                              {opts.generatePreviewUrl && " · Preview URL"}
                            </div>}
                          </div>
                          <div className="flex justify-end gap-2 p-5">
                            <button onClick={() => setRedeploySlug(null)} className="rounded px-4 py-2 text-xs font-mono text-muted hover:bg-card hover:text-accent">
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                setRedeploySlug(null);
                                triggerDeploy(project.slug);
                              }}
                              disabled={deploying === project.slug}
                              className="rounded bg-accent/10 px-4 py-2 text-xs font-mono text-accent hover:bg-accent/20 disabled:opacity-50"
                            >
                              Redeploy
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
        </div>
      )}

      {replicateState && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setReplicateState(null)}>
          <div className="w-full max-w-lg rounded-xl bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Replicate deployment</h3>
              <p className="mt-1 text-xs font-mono text-muted">{replicateState.project.name}</p>
            </div>
            <div className="space-y-3">
              <TextInput
                label="New deployment slug"
                value={replicateState.newSlug}
                onChange={(newSlug) => setReplicateState({ ...replicateState, newSlug })}
              />
              <label className="block">
                <span className="mb-1 block text-[10px] font-mono text-muted">Environment</span>
                <select
                  value={replicateState.envStrategy}
                  onChange={(event) => setReplicateState({ ...replicateState, envStrategy: event.target.value as "copy" | "blank" })}
                  className="w-full rounded-lg bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="blank">Create blank env</option>
                  <option value="copy">Copy current env</option>
                </select>
              </label>
              <div className="rounded-lg bg-background/50 p-3 text-xs text-muted">
                Replication creates an isolated deployment copy. Domains and host ports are not reused automatically.
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setReplicateState(null)} className="rounded px-4 py-2 text-xs font-mono text-muted hover:bg-background hover:text-accent">
                Cancel
              </button>
              <button onClick={performReplicate} disabled={!replicateState.newSlug.trim()} className="rounded bg-accent/10 px-4 py-2 text-xs font-mono text-accent hover:bg-accent/20 disabled:opacity-50">
                Replicate
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteState && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setDeleteState(null)}>
          <div className="w-full max-w-lg rounded-xl bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Delete deployment</h3>
              <p className="mt-1 text-xs font-mono text-muted">{deleteState.project.name}</p>
            </div>
            <div className="space-y-3 text-xs">
              <InfoTile label="Root" value={deleteState.project.path} />
              <InfoTile label="Components" value={deleteState.project.services.map((service) => service.name).join(", ") || "No services parsed"} />
              <label className="flex items-center gap-2 rounded-lg bg-background/50 p-3 font-mono text-muted">
                <input
                  type="checkbox"
                  checked={deleteState.deleteVolumes}
                  onChange={(event) => setDeleteState({ ...deleteState, deleteVolumes: event.target.checked })}
                  className="accent-error"
                />
                Delete compose volumes
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteState(null)} className="rounded px-4 py-2 text-xs font-mono text-muted hover:bg-background hover:text-accent">
                Cancel
              </button>
              <button onClick={performDelete} className="rounded bg-error/10 px-4 py-2 text-xs font-mono text-error hover:bg-error/20">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmCompose && (
        <ActionConfirm
          open={!!confirmCompose}
          action={confirmCompose.type === "stop" ? "compose-down" : confirmCompose.type === "restart" ? "restart" : "compose-up"}
          targetName={resolveLifecycleScope(confirmCompose.projectName, selectedServicesFor(confirmCompose.slug)).targetName}
          targetType={resolveLifecycleScope(confirmCompose.projectName, selectedServicesFor(confirmCompose.slug)).label}
          onConfirm={() =>
            runCompose(
              confirmCompose.slug,
              confirmCompose.type,
              resolveLifecycleScope(confirmCompose.projectName, selectedServicesFor(confirmCompose.slug)).services
            )
          }
          onCancel={() => setConfirmCompose(null)}
        />
      )}
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card p-3">
      <div className="mb-1 text-[10px] font-mono text-muted">{label}</div>
      <div className="break-words text-sm font-mono text-foreground">{value || "Not set"}</div>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-mono text-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-mono text-muted">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="w-full rounded-lg bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
