"use client";

import { useEffect, useState, useCallback } from "react";
import { type Node, type Edge } from "@xyflow/react";
import TopologyFlow from "@/components/TopologyFlow";
import type { TopologyFilters } from "@/components/TopologyFlow";
import XRayPanel from "@/components/XRayPanel";
import { linkSitesToContainers, buildProjectTopology } from "@/lib/topology";
import type { ScannedProjectLite, Site } from "@/lib/topology";
import type { TopoNodeData } from "@/components/TopoNode";

interface CaddySite {
  domain: string;
  root: string | null;
  proxy: string | null;
  content: string;
  file: string;
}

interface Container {
  name: string;
  image: string;
  status: string;
  state: string;
  stats?: { cpu: string; mem: string; pids: string };
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
  composeConfigFiles?: string;
  projectSlug?: string;
}

type ViewMode = "projects" | "sites";

function isRawDomain(domain: string): boolean {
  if (!domain || domain === "localhost" || domain === "127.0.0.1") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return true;
  if (/^\[?::1\]?$/.test(domain)) return true;
  return false;
}

function containerHealth(c: Container): TopoNodeData["health"] {
  if (c.state !== "running") return "critical";
  if (c.status.includes("unhealthy")) return "warning";
  return "healthy";
}

export default function TopologyPage() {
  const [nodes, setNodes] = useState<Node<TopoNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("projects");
  const [dbProjects, setDbProjects] = useState<{ slug: string; name: string; domain?: string | null; path?: string | null }[]>([]);
  const [scannedProjects, setScannedProjects] = useState<ScannedProjectLite[]>([]);
  const [filters, setFilters] = useState<TopologyFilters>({});
  const [xrayTarget, setXrayTarget] = useState<{
    type: "container" | "site" | "host" | "caddy" | "nginx" | "system";
    id: string;
    name: string;
    data?: any;
  } | null>(null);

  const fetchTopology = useCallback(
    async (mode: ViewMode) => {
      setLoading(true);
      try {
        const [projectsRes, containersRes] = await Promise.all([
          fetch("/api/projects"),
          fetch("/api/containers"),
        ]);

        const projects = await projectsRes.json();
        const containersPayload = await containersRes.json();
        const containers: Container[] = Array.isArray(containersPayload) ? containersPayload : [];

        const allSites: CaddySite[] = projects.caddySites || [];
        const dbProjectsData = projects.projects || [];
        const scanned: ScannedProjectLite[] = projects.scannedProjects || [];
        setDbProjects(dbProjectsData);
        setScannedProjects(scanned);
        const services: any[] = projects.services || [];
        const sites = allSites.filter((s) => !isRawDomain(s.domain));
        const hasNginx = services.some((s) => s.name.toLowerCase().includes("nginx"));

        let siteMaps: { siteDomain: string; containerName: string }[] = [];
        try {
          const mapsRes = await fetch("/api/site-maps");
          if (mapsRes.ok) siteMaps = await mapsRes.json();
        } catch {
          // ignore
        }

        if (mode === "projects") {
          buildProjectGraph(scanned, containers, sites as Site[], siteMaps, hasNginx, setNodes, setEdges);
        } else {
          buildSiteGraph(sites as Site[], containers, siteMaps, dbProjectsData, hasNginx, setNodes, setEdges);
        }
      } catch (err) {
        console.error(err);
        // Graceful empty state on any failure (e.g. no VPS / scan error).
        setNodes([]);
        setEdges([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchTopology(view);
    const interval = setInterval(() => fetchTopology(view), 10000);
    return () => clearInterval(interval);
  }, [fetchTopology, view]);

  const handleNodeClick = useCallback((node: Node<TopoNodeData>) => {
    const data = node.data;
    if (node.id === "unmapped" || node.id === "unclaimed") {
      setXrayTarget({ type: "system", id: "system", name: "Unclaimed Containers" });
      return;
    }
    if (data.type === "container" || data.type === "service") {
      const name = data.containerName || data.label;
      setXrayTarget({ type: "container", id: name, name, data: node.data });
    } else if (data.type === "site") {
      setXrayTarget({ type: "site", id: data.label, name: data.label, data: node.data });
    } else if (data.type === "proxy") {
      setXrayTarget({ type: data.subType === "nginx" ? "nginx" : "caddy", id: node.id, name: data.label, data: {} });
    } else if (data.type === "project") {
      setXrayTarget({ type: "system", id: data.label, name: data.label, data: node.data });
    }
  }, []);

  // Project filter options come from scanned projects in project view, DB in site view.
  const filterProjects =
    view === "projects"
      ? scannedProjects.map((p) => ({ slug: p.slug, name: p.name }))
      : dbProjects.map((p) => ({ slug: p.slug, name: p.name || p.slug }));

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Topology</h1>
          <p className="text-muted mt-1">
            {view === "projects"
              ? "Projects mapped from the filesystem → services → containers/images"
              : "Caddy sites → traffic flow → containers"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-success" /> Healthy
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-warning" /> Warning
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-error" /> Critical
          </span>
        </div>
      </div>

      {/* View toggle + Filter Bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-mono">
          <button
            onClick={() => setView("projects")}
            className={`px-3 py-1.5 transition-colors ${view === "projects" ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground"}`}
          >
            Projects
          </button>
          <button
            onClick={() => setView("sites")}
            className={`px-3 py-1.5 transition-colors border-l border-border ${view === "sites" ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground"}`}
          >
            Sites
          </button>
        </div>
        <select
          className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent"
          value={filters.status || ""}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as TopologyFilters["status"] || undefined }))}
        >
          <option value="">All Statuses</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
          <option value="unhealthy">Unhealthy</option>
          <option value="unknown">Unknown</option>
        </select>
        <select
          className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-accent"
          value={filters.projectSlug || ""}
          onChange={(e) => setFilters((f) => ({ ...f, projectSlug: e.target.value || undefined }))}
        >
          <option value="">All Projects</option>
          {filterProjects.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name || p.slug}</option>
          ))}
        </select>
        {(filters.status || filters.projectSlug) && (
          <button
            onClick={() => setFilters({})}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex-1 bg-card border border-border rounded-xl relative overflow-hidden">
        {loading && nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-pulse text-muted text-sm font-mono">Mapping infrastructure...</div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-center px-6">
            <div className="text-muted text-sm font-mono">
              {view === "projects"
                ? "No projects discovered. Configure a VPS and place compose files under your project root."
                : "No sites discovered."}
            </div>
          </div>
        ) : (
          <TopologyFlow
            initialNodes={nodes}
            initialEdges={edges}
            filters={filters}
            dbProjects={dbProjects}
            onNodeClick={handleNodeClick}
          />
        )}
      </div>

      <XRayPanel target={xrayTarget} onClose={() => setXrayTarget(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph builders
// ---------------------------------------------------------------------------

function buildProjectGraph(
  scanned: ScannedProjectLite[],
  containers: Container[],
  sites: Site[],
  siteMaps: { siteDomain: string; containerName: string }[],
  hasNginx: boolean,
  setNodes: (n: Node<TopoNodeData>[]) => void,
  setEdges: (e: Edge[]) => void
) {
  const topo = buildProjectTopology(scanned, containers, sites, siteMaps);

  const nodes: Node<TopoNodeData>[] = [];
  const edges: Edge[] = [];

  // Root: the host / project root.
  nodes.push({
    id: "host",
    type: "topoNode",
    position: { x: 0, y: 0 },
    data: { label: "Project Root", type: "internet", health: "healthy", sub: `${scanned.length} projects` },
  });

  for (const project of topo.projects) {
    const projectId = `project-${project.slug}`;
    // Project health rolls up from its services/containers.
    const liveContainers = [
      ...project.services.map((s) => s.container).filter(Boolean),
      ...project.extraContainers,
    ] as Container[];
    const anyCritical = project.services.some((s) => !s.container) || liveContainers.some((c) => c.state !== "running");
    const anyWarn = liveContainers.some((c) => c.status.includes("unhealthy"));
    const projectHealth: TopoNodeData["health"] =
      liveContainers.length === 0 && project.services.length > 0
        ? "warning"
        : anyCritical
        ? "warning"
        : anyWarn
        ? "warning"
        : "healthy";

    nodes.push({
      id: projectId,
      type: "topoNode",
      position: { x: 0, y: 0 },
      data: {
        label: project.slug,
        type: "project",
        health: projectHealth,
        projectSlug: project.slug,
        projectPath: project.path,
        projectParent: project.parent,
        serviceCount: project.services.length,
        hasGit: project.hasGit,
        sub: project.parent ? `${project.parent}/ · ${project.services.length} svc` : undefined,
      },
    });
    edges.push({ id: `e-host-${projectId}`, source: "host", target: projectId });

    // Sites/domains attached to the project.
    project.sites.forEach((site) => {
      const siteId = `psite-${project.slug}-${site.domain}`;
      nodes.push({
        id: siteId,
        type: "topoNode",
        position: { x: 0, y: 0 },
        data: {
          label: site.domain,
          type: "site",
          health: site.root || site.proxy ? "healthy" : "warning",
          sub: hasNginx && site.proxy ? "proxy" : undefined,
        },
      });
      edges.push({ id: `e-${projectId}-${siteId}`, source: projectId, target: siteId });
    });

    // Services declared by the compose file.
    project.services.forEach((svc, i) => {
      const serviceId = `service-${project.slug}-${svc.service}-${i}`;
      const container = svc.container;
      const health: TopoNodeData["health"] = container
        ? containerHealth(container)
        : "warning"; // declared but not running
      nodes.push({
        id: serviceId,
        type: "topoNode",
        position: { x: 0, y: 0 },
        data: {
          label: svc.service,
          type: "service",
          health,
          projectSlug: project.slug,
          image: svc.image,
          ports: svc.ports,
          containerName: container?.name,
          state: container?.state,
          status: container?.status,
          stats: container?.stats,
          sub: svc.image || (svc.build ? "build" : "no image"),
        },
      });
      edges.push({ id: `e-${projectId}-${serviceId}`, source: projectId, target: serviceId });

      // Container/image leaf under the service when one is live.
      if (container) {
        const containerId = `container-${container.name}`;
        nodes.push({
          id: containerId,
          type: "topoNode",
          position: { x: 0, y: 0 },
          data: {
            label: container.name,
            type: "container",
            health: containerHealth(container),
            stats: container.stats,
            state: container.state,
            status: container.status,
            projectSlug: project.slug,
            image: container.image,
            containerName: container.name,
            composeProject: container.composeProject,
            composeWorkingDir: container.composeWorkingDir,
            sub: container.image,
          },
        });
        edges.push({ id: `e-${serviceId}-${containerId}`, source: serviceId, target: containerId });
      }
    });

    // Extra containers belonging to the project but not matched to a service.
    project.extraContainers.forEach((container) => {
      const containerId = `container-${container.name}`;
      nodes.push({
        id: containerId,
        type: "topoNode",
        position: { x: 0, y: 0 },
        data: {
          label: container.name,
          type: "container",
          health: containerHealth(container),
          stats: container.stats,
          state: container.state,
          status: container.status,
          projectSlug: project.slug,
          image: container.image,
          containerName: container.name,
          composeProject: container.composeProject,
          composeWorkingDir: container.composeWorkingDir,
          sub: container.image,
        },
      });
      edges.push({ id: `e-${projectId}-${containerId}`, source: projectId, target: containerId });
    });
  }

  // Unclaimed containers (no scanned project owns them).
  if (topo.unclaimedContainers.length > 0) {
    nodes.push({
      id: "unclaimed",
      type: "topoNode",
      position: { x: 0, y: 0 },
      data: { label: "Unmapped", type: "container", health: "unknown" },
    });
    edges.push({ id: "e-host-unclaimed", source: "host", target: "unclaimed" });
    topo.unclaimedContainers.forEach((c) => {
      const id = `container-${c.name}`;
      nodes.push({
        id,
        type: "topoNode",
        position: { x: 0, y: 0 },
        data: {
          label: c.name,
          type: "container",
          health: containerHealth(c),
          stats: c.stats,
          state: c.state,
          status: c.status,
          image: c.image,
          containerName: c.name,
          composeProject: c.composeProject,
          composeWorkingDir: c.composeWorkingDir,
          sub: c.image,
        },
      });
      edges.push({ id: `e-unclaimed-${id}`, source: "unclaimed", target: id });
    });
  }

  setNodes(nodes);
  setEdges(edges);
}

function buildSiteGraph(
  sites: Site[],
  containers: Container[],
  siteMaps: { siteDomain: string; containerName: string }[],
  dbProjects: { slug: string; name: string; domain?: string | null; path?: string | null }[],
  hasNginx: boolean,
  setNodes: (n: Node<TopoNodeData>[]) => void,
  setEdges: (e: Edge[]) => void
) {
  const { siteGroups, unmapped } = linkSitesToContainers(sites, containers, siteMaps, dbProjects);

  const nodes: Node<TopoNodeData>[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: "internet",
    type: "topoNode",
    position: { x: 0, y: 0 },
    data: { label: "Internet", type: "internet", health: "healthy" },
  });
  nodes.push({
    id: "caddy",
    type: "topoNode",
    position: { x: 0, y: 0 },
    data: { label: "Caddy", type: "proxy", subType: "caddy", health: "healthy" },
  });
  edges.push({ id: "e-internet-caddy", source: "internet", target: "caddy" });

  if (hasNginx) {
    nodes.push({
      id: "nginx",
      type: "topoNode",
      position: { x: 0, y: 0 },
      data: { label: "Nginx", type: "proxy", subType: "nginx", health: "healthy" },
    });
    edges.push({ id: "e-internet-nginx", source: "internet", target: "nginx" });
  }

  sites.forEach((site) => {
    const id = `site-${site.domain}`;
    nodes.push({
      id,
      type: "topoNode",
      position: { x: 0, y: 0 },
      data: {
        label: site.domain,
        type: "site",
        health: site.root || site.proxy ? "healthy" : "warning",
      },
    });
    edges.push({ id: `e-caddy-${id}`, source: "caddy", target: id });
    if (hasNginx) edges.push({ id: `e-nginx-${id}`, source: "nginx", target: id });
  });

  siteGroups.forEach((group) => {
    const siteId = `site-${group.site.domain}`;
    group.containers.forEach((c) => {
      const id = `container-${c.name}`;
      nodes.push({
        id,
        type: "topoNode",
        position: { x: 0, y: 0 },
        data: {
          label: c.name,
          type: "container",
          health: containerHealth(c),
          stats: c.stats,
          state: c.state,
          status: c.status,
          image: c.image,
          containerName: c.name,
          composeProject: c.composeProject,
          composeWorkingDir: c.composeWorkingDir,
          projectSlug: c.projectSlug,
          sub: c.image,
        },
      });
      edges.push({ id: `e-${siteId}-${id}`, source: siteId, target: id });
    });
  });

  if (unmapped.length > 0) {
    nodes.push({
      id: "unmapped",
      type: "topoNode",
      position: { x: 0, y: 0 },
      data: { label: "Unmapped", type: "container", health: "unknown" },
    });
    unmapped.forEach((c) => {
      const id = `container-${c.name}`;
      nodes.push({
        id,
        type: "topoNode",
        position: { x: 0, y: 0 },
        data: {
          label: c.name,
          type: "container",
          health: containerHealth(c),
          stats: c.stats,
          state: c.state,
          status: c.status,
          image: c.image,
          containerName: c.name,
          composeProject: c.composeProject,
          composeWorkingDir: c.composeWorkingDir,
          projectSlug: c.projectSlug,
          sub: c.image,
        },
      });
      edges.push({ id: `e-unmapped-${id}`, source: "unmapped", target: id });
    });
  }

  setNodes(nodes);
  setEdges(edges);
}
