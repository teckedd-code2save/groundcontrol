"use client";

import { useEffect, useState, useMemo } from "react";
import { ContainerIcon, getContainerType, getContainerTypeLabel } from "@/components/TopoIcons";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { ActionConfirm } from "@/components/ActionConfirm";
import type { TerraformStack } from "@/components/TerraformStacksTab";
import { DeploymentEnvPanel } from "@/components/DeploymentEnvPanel";
import { resolveLifecycleScope, type LifecycleAction } from "@/lib/deployment-actions";

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
  createdAt: string;
  updatedAt: string;
  project: { id: number; slug: string; name: string };
  target: DeploymentTarget;
}

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

function statusColor(status: string): string {
  switch (status) {
    case "success":
      return "bg-success/10 text-success border-success/30";
    case "failed":
    case "rolled_back":
      return "bg-error/10 text-error border-error/30";
    case "running":
    case "building":
    case "deploying":
      return "bg-accent/10 text-accent border-accent/30";
    default:
      return "bg-warning/10 text-warning border-warning/30";
  }
}

export function ProjectsPanel() {
  const [data, setData] = useState<ProjectData | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [confirmDeploy, setConfirmDeploy] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState("/opt");
  const [templateDeploymentRoot, setTemplateDeploymentRoot] = useState("/srv/groundcontrol/deployments");
  const [error, setError] = useState("");
  const [composeAction, setComposeAction] = useState<ComposeActionState | null>(null);
  const [composeOutput, setComposeOutput] = useState<{ slug: string; output: string; error?: string } | null>(null);
  const [selectedServices, setSelectedServices] = useState<Record<string, Set<string>>>({});
  const [confirmCompose, setConfirmCompose] = useState<ConfirmComposeState | null>(null);
  const [envOpen, setEnvOpen] = useState<Record<string, boolean>>({});
  const [adoptedProjects, setAdoptedProjects] = useState<Record<string, ProjectRecord>>({});

  const [targets, setTargets] = useState<DeploymentTarget[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [zones, setZones] = useState<CloudflareZone[]>([]);
  const [stacks, setStacks] = useState<TerraformStack[]>([]);
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
      fetch("/api/system-config")
        .then((r) => safeJson(r))
        .catch(() => ({ ok: true, data: null, text: "" })),
      fetch("/api/deployment-targets")
        .then((r) => safeJson(r))
        .catch(() => ({ ok: true, data: [], text: "" })),
      fetch("/api/deployments")
        .then((r) => safeJson(r))
        .catch(() => ({ ok: true, data: [], text: "" })),
      fetch("/api/cloudflare/zones")
        .then((r) => safeJson(r))
        .catch(() => ({ ok: true, data: { success: false, result: [] }, text: "" })),
      fetch("/api/terraform/stacks")
        .then((r) => safeJson(r))
        .catch(() => ({ ok: true, data: [], text: "" })),
    ])
      .then(([projectsRes, containersRes, imagesRes, configRes, targetsRes, deploymentsRes, zonesRes, stacksRes]) => {
        setData(projectsRes.data);
        setContainers(Array.isArray(containersRes.data) ? containersRes.data : []);
        setImages(Array.isArray(imagesRes.data) ? imagesRes.data : []);
        if (configRes.data?.projectRoot) setProjectRoot(configRes.data.projectRoot);
        if (configRes.data?.templateDeploymentRoot) setTemplateDeploymentRoot(configRes.data.templateDeploymentRoot);
        if (projectsRes.data?.scanError) setError(`Scan warning: ${projectsRes.data.scanError}`);

        const loadedTargets: DeploymentTarget[] = Array.isArray(targetsRes.data) ? targetsRes.data : [];
        setTargets(loadedTargets);

        const loadedDeployments: Deployment[] = Array.isArray(deploymentsRes.data) ? deploymentsRes.data : [];
        setDeployments(loadedDeployments);

        const zoneResult = zonesRes.data?.result;
        setZones(Array.isArray(zoneResult) ? zoneResult : []);
        setStacks(Array.isArray(stacksRes.data) ? stacksRes.data : []);

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
      setConfirmDeploy(null);
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
          setConfirmDeploy(null);
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
          setConfirmDeploy(null);
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
      setConfirmDeploy(null);
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
      const label = type === "start" ? "Start" : type === "stop" ? "Stop" : "Restart";
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
      const label = type === "start" ? "Start" : type === "stop" ? "Stop" : "Restart";
      setError(`${label} failed: ${message}`);
      setComposeOutput({ slug, output: "", error: message });
    } finally {
      setComposeAction(null);
      setConfirmCompose(null);
    }
  }

  async function replicateDeployment(project: ScannedProject) {
    const suggested = `${project.slug}-copy`;
    const newSlug = window.prompt("New deployment slug", suggested);
    if (!newSlug) return;
    const copyEnv = window.confirm("Copy .env values into the replica? Cancel leaves a blank .env with 600 permissions.");
    setComposeOutput({ slug: project.slug, output: "Creating isolated deployment copy..." });
    try {
      const res = await fetch("/api/deployments/replicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: project.path,
          sourceSlug: project.slug,
          newSlug,
          envStrategy: copyEnv ? "copy" : "blank",
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
    const confirmed = window.confirm(
      `Delete deployment?\n\nRoot: ${project.path}\nContainers: docker compose down\nVolumes: kept by default\nNetworks: compose-managed networks removed`
    );
    if (!confirmed) return;
    const deleteVolumes = window.confirm("Also delete compose volumes? Cancel keeps data volumes.");
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
      const key = p.managed ? "__managed__" : p.parent || "__discovered__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === "__managed__") return -1;
      if (b[0] === "__managed__") return 1;
      if (a[0] === "__discovered__") return -1;
      if (b[0] === "__discovered__") return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [projects]);

  if (loading) {
    return <LoaderOverlay3D open={loading} variant="project" title="Loading projects..." />;
  }

  return (
    <div className="space-y-6 relative">
      <LoaderOverlay3D
        open={!!composeAction}
        variant="compose"
        title={composeAction ? `${composeAction.type === "start" ? "Starting" : composeAction.type === "stop" ? "Stopping" : "Restarting"} deployment...` : "Updating deployment..."}
      />
      <LoaderOverlay3D
        open={!!deploying}
        variant="deploy"
        title={deploying ? `Deploying ${deploying}...` : "Deploying..."}
      />
      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 hover:text-foreground">✕</button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 text-muted text-sm">
          No compose-bearing projects found under {projectRoot}/. Place a{" "}
          <code>docker-compose.yml</code> in a project directory to see it here.
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([parent, groupProjects]) => (
            <div key={parent || "root"} className="space-y-4">
              {parent === "__managed__" ? (
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-mono tracking-wider text-success">
                      Managed deployments
                    </h2>
                    <p className="text-[10px] text-muted/70">
                      Created by templates under {templateDeploymentRoot}; use the card menu for up, down, redeploy,
                      replicate, and delete.
                    </p>
                  </div>
                  <span className="self-start rounded bg-success/10 px-2 py-1 text-[10px] font-mono text-success">
                    {groupProjects.length} managed
                  </span>
                </div>
              ) : parent === "__discovered__" ? (
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-mono tracking-wider text-muted">
                      Discovered deployments
                    </h2>
                    <p className="text-[10px] text-muted/70">
                      Compose projects found under {projectRoot}; GroundControl can start, stop, replicate, or redeploy
                      them when metadata is available.
                    </p>
                  </div>
                  <span className="self-start rounded bg-border/50 px-2 py-1 text-[10px] font-mono text-muted">
                    {groupProjects.length} discovered
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-mono tracking-wider text-muted">
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
                    className="bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-colors"
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
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            project.managed ? "text-success bg-success/10" : "text-muted bg-border/50"
                          }`}>
                            {project.managed ? "managed" : "discovered"}
                          </span>
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
                          <p className="text-xs text-muted font-mono mt-1">No domain mapped</p>
                        )}
                        <p className="text-xs text-muted font-mono mt-0.5 truncate">{project.path}</p>

                        {latest && (latest.publicUrl || latest.previewUrl) && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {latest.publicUrl && (
                              <a
                                href={latest.publicUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border bg-success/10 text-success border-success/30 hover:bg-success/20 transition-colors"
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
                                className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border bg-accent/10 text-accent border-accent/30 hover:bg-accent/20 transition-colors"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                                preview
                              </a>
                            )}
                            {latest.status && (
                              <span className={`text-[10px] font-mono px-2 py-1 rounded border ${statusColor(latest.status)}`}>
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
                              onClick={() => setConfirmDeploy(project.slug)}
                              disabled={deploying === project.slug}
                              className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                              title="Run the full deployment pipeline"
                            >
                              Redeploy
                            </button>
                          ) : (
                            <button
                              onClick={() => setConfirmCompose({ slug: project.slug, type: "start", projectName: project.name })}
                              disabled={!!composeAction}
                              className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-mono text-success transition-colors hover:bg-success/20 disabled:opacity-50"
                              title="Start the deployment or selected services"
                            >
                              Start
                            </button>
                          )
                        )}
                        <details className="group relative">
                          <summary
                            className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-background text-lg leading-none text-muted transition-colors hover:border-accent hover:text-accent [&::-webkit-details-marker]:hidden"
                            title="Deployment actions"
                            aria-label={`Actions for ${project.name}`}
                          >
                            ⋮
                          </summary>
                          <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-lg border border-border bg-card shadow-xl shadow-black/20">
                            {!isInvalid && (
                              <>
                                <button
                                  onClick={() => setConfirmCompose({ slug: project.slug, type: "stop", projectName: project.name })}
                                  disabled={!!composeAction}
                                  className="block w-full px-3 py-2 text-left text-xs font-mono text-warning transition-colors hover:bg-warning/10 disabled:opacity-50"
                                  title="Stop the deployment or selected services"
                                >
                                  Stop
                                </button>
                                <button
                                  onClick={() => setConfirmCompose({ slug: project.slug, type: "restart", projectName: project.name })}
                                  disabled={!!composeAction}
                                  className="block w-full px-3 py-2 text-left text-xs font-mono text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
                                  title="Restart the deployment or selected services"
                                >
                                  Restart
                                </button>
                                <div className="border-t border-border" />
                              </>
                            )}
                            <button
                              onClick={async () => {
                                const record = await ensureProjectRecord(project);
                                if (record) setEnvOpen((prev) => ({ ...prev, [project.slug]: !prev[project.slug] }));
                              }}
                              className="block w-full px-3 py-2 text-left text-xs font-mono text-muted transition-colors hover:bg-background hover:text-accent"
                              title="Manage deployment environment"
                            >
                              Environment
                            </button>
                            <button
                              onClick={() => replicateDeployment(project)}
                              disabled={!!composeAction}
                              className="block w-full px-3 py-2 text-left text-xs font-mono text-muted transition-colors hover:bg-background hover:text-accent disabled:opacity-50"
                              title="Replicate deployment"
                            >
                              Replicate
                            </button>
                            <button
                              onClick={() => deleteManagedDeployment(project)}
                              disabled={!!composeAction}
                              className="block w-full px-3 py-2 text-left text-xs font-mono text-error transition-colors hover:bg-error/10 disabled:opacity-40"
                              title="Delete deployment"
                            >
                              Delete
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>

                    {getDbProject(project.slug) && envOpen[project.slug] && (
                      <div className="mb-4">
                        <DeploymentEnvPanel
                          projectId={getDbProject(project.slug)!.id}
                          deploymentId={latest?.id}
                          onRedeploy={() => setConfirmDeploy(project.slug)}
                        />
                      </div>
                    )}

                    {/* Deploy options */}
                    {!isInvalid && <div className="mb-4 p-3 bg-background/50 border border-border rounded-lg space-y-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <div>
                          <label className="block text-[10px] font-mono text-muted mb-1">Redeploy target</label>
                          <select
                            value={opts.targetId}
                            onChange={(e) => updateDeployOptions(project.slug, { targetId: e.target.value ? Number(e.target.value) : "" })}
                            className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent min-w-[140px]"
                          >
                            <option value="">Default target</option>
                            {targets.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({t.type})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono text-muted mb-1">Branch</label>
                          <input
                            type="text"
                            value={opts.branch}
                            onChange={(e) => updateDeployOptions(project.slug, { branch: e.target.value })}
                            placeholder="main"
                            className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-32"
                          />
                        </div>
                        <label className="flex items-center gap-2 text-xs font-mono text-muted cursor-pointer">
                          <input
                            type="checkbox"
                            checked={opts.generatePreviewUrl}
                            onChange={(e) => updateDeployOptions(project.slug, { generatePreviewUrl: e.target.checked })}
                            className="accent-accent"
                          />
                          Generate preview URL
                        </label>
                      </div>

                      {isK3s && (
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Replicas</label>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={opts.replicas}
                              onChange={(e) => updateDeployOptions(project.slug, { replicas: Math.max(1, Number(e.target.value) || 1) })}
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-24"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Port</label>
                            <input
                              type="number"
                              min={1}
                              max={65535}
                              value={opts.port}
                              onChange={(e) => updateDeployOptions(project.slug, { port: Math.max(1, Number(e.target.value) || 1) })}
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-24"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Ingress class</label>
                            <select
                              value={opts.ingressClass}
                              onChange={(e) => updateDeployOptions(project.slug, { ingressClass: e.target.value as "traefik" | "caddy" })}
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent min-w-[120px]"
                            >
                              <option value="traefik">Traefik</option>
                              <option value="caddy">Caddy</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {isCloudRun && (
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">GCP Project</label>
                            <input
                              type="text"
                              value={opts.projectId}
                              onChange={(e) => updateDeployOptions(project.slug, { projectId: e.target.value })}
                              placeholder="my-project-123"
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-40"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Region</label>
                            <input
                              type="text"
                              value={opts.region}
                              onChange={(e) => updateDeployOptions(project.slug, { region: e.target.value })}
                              placeholder="us-central1"
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-32"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Service name</label>
                            <input
                              type="text"
                              value={opts.serviceName}
                              onChange={(e) => updateDeployOptions(project.slug, { serviceName: e.target.value })}
                              placeholder={project.slug}
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-40"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">CPU</label>
                            <input
                              type="number"
                              min={1}
                              max={8}
                              step={1}
                              value={opts.cpu}
                              onChange={(e) => updateDeployOptions(project.slug, { cpu: Math.max(1, Number(e.target.value) || 1) })}
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-20"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Memory</label>
                            <input
                              type="text"
                              value={opts.memory}
                              onChange={(e) => updateDeployOptions(project.slug, { memory: e.target.value })}
                              placeholder="512Mi"
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-24"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Concurrency</label>
                            <input
                              type="number"
                              min={1}
                              max={1000}
                              value={opts.concurrency}
                              onChange={(e) => updateDeployOptions(project.slug, { concurrency: Math.max(1, Number(e.target.value) || 1) })}
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-24"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Max instances</label>
                            <input
                              type="number"
                              min={1}
                              max={1000}
                              value={opts.maxInstances}
                              onChange={(e) => updateDeployOptions(project.slug, { maxInstances: Math.max(1, Number(e.target.value) || 1) })}
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-24"
                            />
                          </div>
                        </div>
                      )}

                      {isTerraform && (
                        <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg space-y-2">
                          <div className="text-[11px] text-muted leading-relaxed">
                            <strong className="text-accent">Provision infra first:</strong> this target references a
                            Terraform stack. GroundControl will run <span className="font-mono">terraform apply</span>{" "}
                            before deploying the project.
                          </div>
                          <div className="text-[10px] font-mono text-muted">
                            Stack:{" "}
                            {(() => {
                              try {
                                const cfg = JSON.parse(selectedTarget?.configJson || "{}");
                                const stack = stacks.find((s) => String(s.id) === String(cfg.stackId));
                                return stack ? `${stack.name} (${stack.provider})` : cfg.stackId || "none";
                              } catch {
                                return "none";
                              }
                            })()}
                          </div>
                        </div>
                      )}

                      {zones.length > 0 && (
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Subdomain</label>
                            <input
                              type="text"
                              value={opts.subdomain}
                              onChange={(e) => updateDeployOptions(project.slug, { subdomain: e.target.value })}
                              placeholder={`${project.slug}.example.com`}
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent w-56"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-mono text-muted mb-1">Zone</label>
                            <select
                              value={opts.zoneId}
                              onChange={(e) => updateDeployOptions(project.slug, { zoneId: e.target.value })}
                              className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent min-w-[160px]"
                            >
                              <option value="">Select zone</option>
                              {zones.map((z) => (
                                <option key={z.id} value={z.id}>
                                  {z.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <label className="flex items-center gap-2 text-xs font-mono text-muted cursor-pointer">
                            <input
                              type="checkbox"
                              checked={opts.proxied}
                              onChange={(e) => updateDeployOptions(project.slug, { proxied: e.target.checked })}
                              className="accent-accent"
                            />
                            Proxied
                          </label>
                        </div>
                      )}

                      <div className="text-[10px] text-muted/60 font-mono">
                        Redeploying via {selectedTargetName}
                        {isCloudRun && ` · ${opts.serviceName} · ${opts.region}`}
                        {isTerraform && " · terraform provision + deploy"}
                        {opts.generatePreviewUrl && " · quick tunnel preview"}
                        {opts.subdomain && opts.zoneId && ` · ${opts.subdomain} → ${zones.find((z) => z.id === opts.zoneId)?.name || opts.zoneId}`}
                        {project.managed && ` · managed root ${templateDeploymentRoot}`}
                      </div>
                    </div>}

                    {/* Components */}
                    {isInvalid ? (
                      <div className="mb-4 text-[10px] text-warning font-mono bg-warning/5 border border-warning/20 p-2 rounded-lg">
                        Compose file at {project.composePath} is invalid: {project.parseError || "services must be a mapping"}
                      </div>
                    ) : project.services.length > 0 ? (
                      <div className="mb-4 space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <h4 className="text-[10px] font-mono tracking-wider text-muted">
                            Components ({project.services.length})
                          </h4>
                          {selected.length > 0 && (
                            <span className="rounded border border-accent/20 bg-accent/5 px-2 py-1 text-[10px] font-mono text-accent">
                              {selected.length} selected
                            </span>
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
                                className={`flex items-center justify-between gap-2 p-2 rounded-lg border ${
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
                                    <div className="flex items-center gap-1.5">
                                      <ContainerIcon
                                        className="w-3.5 h-3.5"
                                        type={getContainerType(svc.name, svc.image || "")}
                                      />
                                      <div className="text-xs font-mono truncate">{svc.name}</div>
                                    </div>
                                    <div className="text-[10px] text-muted font-mono truncate">
                                      {svc.image || (svc.build ? "build" : "no image")}
                                      {svc.ports && svc.ports.length > 0 ? ` · :${svc.ports[0]}` : ""}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {existing ? (
                                    <div
                                      className={`w-2 h-2 rounded-full ${isRunning ? "bg-success" : "bg-error"}`}
                                      title={isRunning ? "running" : "stopped"}
                                    />
                                  ) : (
                                    <span className="text-[9px] font-mono text-accent">new</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
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
                        <h4 className="text-[10px] font-mono tracking-wider text-muted">
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
                        <h4 className="text-[10px] font-mono tracking-wider text-muted">
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
              <h2 className="text-sm font-mono tracking-wider text-muted">
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
