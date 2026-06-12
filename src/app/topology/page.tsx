"use client";

import { useEffect, useState, useCallback } from "react";
import { type Node, type Edge } from "@xyflow/react";
import TopologyFlow from "@/components/TopologyFlow";
import type { TopologyFilters } from "@/components/TopologyFlow";
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

function projectGroupHealth(liveContainers: Container[]): TopoNodeData["health"] {
  if (liveContainers.length === 0) return "warning";
  if (liveContainers.some((c) => c.state !== "running")) return "warning";
  if (liveContainers.some((c) => c.status.includes("unhealthy"))) return "warning";
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
        const services: { name: string }[] = projects.services || [];
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
        setNodes([]);
        setEdges([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    async function load() {
      await fetchTopology(view);
    }
    load();
    const interval = setInterval(() => fetchTopology(view), 10000);
    return () => clearInterval(interval);
  }, [fetchTopology, view]);

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
              ? "Host → projects → services → containers"
              : "Internet → proxy → sites → containers"}
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
            key={view}
            initialNodes={nodes}
            initialEdges={edges}
            filters={filters}
            dbProjects={dbProjects}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph builders (group-node based)
// ---------------------------------------------------------------------------

function containerNodeData(c: Container): TopoNodeData {
  return {
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
    sub: `${c.state === "running" ? "running" : c.state} · CPU ${c.stats?.cpu || "—"} · MEM ${c.stats?.mem || "—"}`,
  };
}

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
  const created = new Set<string>();

  nodes.push({
    id: "host",
    type: "topoNode",
    position: { x: 0, y: 0 },
    data: {
      label: "Project Root",
      type: "host",
      health: "healthy",
      sub: `${scanned.length} project${scanned.length === 1 ? "" : "s"}`,
    },
  });

  for (const project of topo.projects) {
    const groupId = `project-group-${project.slug}`;
    const liveContainers = [
      ...project.services.map((s) => s.container).filter(Boolean),
      ...project.extraContainers,
    ] as Container[];
    const projectHealth = projectGroupHealth(liveContainers);
    const childCount = project.services.length + project.extraContainers.length + project.sites.length;

    nodes.push({
      id: groupId,
      type: "group",
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
        childCount,
      },
    });
    created.add(groupId);
    edges.push({ id: `e-host-${groupId}`, source: "host", target: groupId, type: "smoothstep" });

    // Sites are linked inside the project group.
    project.sites.forEach((site) => {
      const siteId = `psite-${project.slug}-${site.domain}`;
      if (created.has(siteId)) return;
      created.add(siteId);
      nodes.push({
        id: siteId,
        type: "topoNode",
        parentId: groupId,
        position: { x: 0, y: 0 },
        data: {
          label: site.domain,
          type: "site",
          health: site.root || site.proxy ? "healthy" : "warning",
          sub: site.proxy ? `proxy → ${site.proxy}` : site.root ? `root: ${site.root}` : "no target",
        },
      });
      edges.push({ id: `e-${groupId}-${siteId}`, source: groupId, target: siteId, type: "smoothstep" });
    });

    // Services declared by the compose file.
    project.services.forEach((svc, i) => {
      const serviceId = `service-${project.slug}-${svc.service}-${i}`;
      const container = svc.container;
      const health: TopoNodeData["health"] = container ? containerHealth(container) : "warning";

      nodes.push({
        id: serviceId,
        type: "topoNode",
        parentId: groupId,
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
      edges.push({ id: `e-${groupId}-${serviceId}`, source: groupId, target: serviceId, type: "smoothstep" });

      if (container) {
        const containerId = `container-${container.name}`;
        if (!created.has(containerId)) {
          created.add(containerId);
          nodes.push({
            id: containerId,
            type: "topoNode",
            parentId: groupId,
            position: { x: 0, y: 0 },
            data: containerNodeData(container),
          });
        }
        edges.push({ id: `e-${serviceId}-${containerId}`, source: serviceId, target: containerId, type: "smoothstep" });
      }
    });

    // Extra containers belonging to the project but not matched to a service.
    project.extraContainers.forEach((container) => {
      const containerId = `container-${container.name}`;
      if (!created.has(containerId)) {
        created.add(containerId);
        nodes.push({
          id: containerId,
          type: "topoNode",
          parentId: groupId,
          position: { x: 0, y: 0 },
          data: { ...containerNodeData(container), projectSlug: project.slug },
        });
      }
    });
  }

  // Unclaimed containers grouped together.
  if (topo.unclaimedContainers.length > 0) {
    const groupId = "unclaimed-group";
    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 0, y: 0 },
      data: {
        label: "Unmapped",
        type: "container",
        health: projectGroupHealth(topo.unclaimedContainers),
        childCount: topo.unclaimedContainers.length,
      },
    });
    edges.push({ id: `e-host-${groupId}`, source: "host", target: groupId, type: "smoothstep" });

    topo.unclaimedContainers.forEach((c) => {
      const id = `container-${c.name}`;
      if (!created.has(id)) {
        created.add(id);
        nodes.push({
          id,
          type: "topoNode",
          parentId: groupId,
          position: { x: 0, y: 0 },
          data: containerNodeData(c),
        });
      }
      edges.push({ id: `e-${groupId}-${id}`, source: groupId, target: id, type: "smoothstep" });
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
  const created = new Set<string>();

  nodes.push({
    id: "internet",
    type: "topoNode",
    position: { x: 0, y: 0 },
    data: { label: "Internet", type: "internet", health: "healthy" },
  });

  const proxyGroupId = "proxy-group";
  nodes.push({
    id: proxyGroupId,
    type: "group",
    position: { x: 0, y: 0 },
    data: { label: "Reverse Proxy", type: "proxy", health: "healthy", childCount: hasNginx ? 2 : 1 },
  });
  created.add(proxyGroupId);
  edges.push({ id: `e-internet-${proxyGroupId}`, source: "internet", target: proxyGroupId, type: "smoothstep" });

  const caddyId = "caddy";
  nodes.push({
    id: caddyId,
    type: "topoNode",
    parentId: proxyGroupId,
    position: { x: 0, y: 0 },
    data: { label: "Caddy", type: "proxy", subType: "caddy", health: "healthy" },
  });
  edges.push({ id: `e-${proxyGroupId}-${caddyId}`, source: proxyGroupId, target: caddyId, type: "smoothstep" });

  if (hasNginx) {
    const nginxId = "nginx";
    nodes.push({
      id: nginxId,
      type: "topoNode",
      parentId: proxyGroupId,
      position: { x: 0, y: 0 },
      data: { label: "Nginx", type: "proxy", subType: "nginx", health: "healthy" },
    });
    edges.push({ id: `e-${proxyGroupId}-${nginxId}`, source: proxyGroupId, target: nginxId, type: "smoothstep" });
  }

  siteGroups.forEach((group) => {
    const siteId = `site-group-${group.site.domain}`;
    const groupHealth: TopoNodeData["health"] =
      group.containers.length === 0 ? "unknown" : group.containers.some((c) => c.state !== "running") ? "warning" : "healthy";

    nodes.push({
      id: siteId,
      type: "group",
      position: { x: 0, y: 0 },
      data: {
        label: group.site.domain,
        type: "site",
        health: groupHealth,
        childCount: group.containers.length,
        sub: group.site.proxy ? (hasNginx ? "nginx proxy" : "caddy proxy") : group.site.root ? "static" : undefined,
      },
    });
    created.add(siteId);
    edges.push({ id: `e-${proxyGroupId}-${siteId}`, source: proxyGroupId, target: siteId, type: "smoothstep" });

    group.containers.forEach((c) => {
      const id = `container-${c.name}`;
      if (!created.has(id)) {
        created.add(id);
        nodes.push({
          id,
          type: "topoNode",
          parentId: siteId,
          position: { x: 0, y: 0 },
          data: containerNodeData(c),
        });
      }
      edges.push({ id: `e-${siteId}-${id}`, source: siteId, target: id, type: "smoothstep" });
    });
  });

  if (unmapped.length > 0) {
    const groupId = "unmapped-group";
    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 0, y: 0 },
      data: {
        label: "Unmapped",
        type: "container",
        health: unmapped.some((c) => c.state !== "running") ? "warning" : "healthy",
        childCount: unmapped.length,
      },
    });
    created.add(groupId);
    edges.push({ id: `e-internet-${groupId}`, source: "internet", target: groupId, type: "smoothstep" });

    unmapped.forEach((c) => {
      const id = `container-${c.name}`;
      if (!created.has(id)) {
        created.add(id);
        nodes.push({
          id,
          type: "topoNode",
          parentId: groupId,
          position: { x: 0, y: 0 },
          data: containerNodeData(c),
        });
      }
      edges.push({ id: `e-${groupId}-${id}`, source: groupId, target: id, type: "smoothstep" });
    });
  }

  setNodes(nodes);
  setEdges(edges);
}
