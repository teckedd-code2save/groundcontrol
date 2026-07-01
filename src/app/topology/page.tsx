"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { type Node, type Edge } from "@xyflow/react";
import TopologyFlow from "@/components/TopologyFlow";
import type { TopologyFilters } from "@/components/TopologyFlow";
import { linkSitesToContainers, buildProjectTopology } from "@/lib/topology";
import type { ScannedProjectLite, Site } from "@/lib/topology";
import type { TopoNodeData } from "@/components/TopoNode";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import type { ProjectRuntime, LiveContainer as RuntimeLiveContainer } from "@/lib/project-runtime";

interface K8sPod {
  name: string;
  namespace: string;
  status: string;
  restarts?: number;
  age?: string;
  ready?: string;
}

interface K8sService {
  name: string;
  namespace: string;
  type: string;
  clusterIP?: string;
  externalIP?: string;
  ports?: string;
}

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const k8sNamespace = searchParams.get("k8sNamespace");

  const [nodes, setNodes] = useState<Node<TopoNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("projects");
  const [dbProjects, setDbProjects] = useState<{ slug: string; name: string; domain?: string | null; path?: string | null }[]>([]);
  const [scannedProjects, setScannedProjects] = useState<ScannedProjectLite[]>([]);
  const [filters, setFilters] = useState<TopologyFilters>({});

  const [k8sPods, setK8sPods] = useState<K8sPod[]>([]);
  const [k8sServices, setK8sServices] = useState<K8sService[]>([]);
  const [k8sLoading, setK8sLoading] = useState(false);
  const [k8sError, setK8sError] = useState("");

  const fetchTopology = useCallback(
    async (mode: ViewMode) => {
      setLoading(true);
      try {
        if (mode === "projects") {
          // Use the new unified ProjectRuntime endpoint
          const rtRes = await fetch("/api/project-runtime");
          if (rtRes.ok) {
            const rt: ProjectRuntime = await rtRes.json();
            buildProjectGraphFromRuntime(rt, setNodes, setEdges);
            setScannedProjects(rt.projects.map(p => ({ slug: p.slug, name: p.name, dirName: p.slug, path: p.path, composePath: p.composePath, parent: p.parent, domain: p.domain, hasGit: p.hasGit, services: p.services.map(s => ({ name: s.name, image: s.image, build: s.build, ports: s.ports })) })));
            setLoading(false);
            return;
          }
        }

        // Fallback to old API for sites view or if new endpoint fails
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

  useEffect(() => {
    if (!k8sNamespace) return;

    let cancelled = false;
    // Data fetching triggered by URL query param change; loading/error state
    // must be reset synchronously before the async fetch begins.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setK8sLoading(true);
    setK8sError("");

    Promise.all([
      fetch(`/api/k8s/pods?namespace=${encodeURIComponent(k8sNamespace)}`),
      fetch(`/api/k8s/services?namespace=${encodeURIComponent(k8sNamespace)}`),
    ])
      .then(async ([podsRes, servicesRes]) => {
        const podsJson = await podsRes.json().catch(() => ({ error: "Invalid response" }));
        const servicesJson = await servicesRes.json().catch(() => ({ error: "Invalid response" }));
        if (cancelled) return;
        if (!podsRes.ok || podsJson.error) {
          setK8sError(podsJson.error || "Failed to load pods");
          setK8sPods([]);
          setK8sServices([]);
          return;
        }
        setK8sPods(Array.isArray(podsJson) ? podsJson : []);
        setK8sServices(Array.isArray(servicesJson) ? servicesJson : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setK8sError(err instanceof Error ? err.message : "Failed to load Kubernetes resources");
        setK8sPods([]);
        setK8sServices([]);
      })
      .finally(() => {
        if (!cancelled) setK8sLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [k8sNamespace]);

  const filterProjects =
    view === "projects"
      ? scannedProjects.map((p) => ({ slug: p.slug, name: p.name }))
      : dbProjects.map((p) => ({ slug: p.slug, name: p.name || p.slug }));

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {k8sNamespace ? `Namespace: ${k8sNamespace}` : "Topology"}
          </h1>
          <p className="text-muted mt-1">
            {k8sNamespace
              ? "Kubernetes pods and services in this namespace"
              : view === "projects"
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
        {k8sNamespace ? (
          <button
            onClick={() => router.push("/topology")}
            className="px-3 py-1.5 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
          >
            ← Back to topology
          </button>
        ) : (
          <>
            <div className="flex rounded-lg border border-border overflow-hidden text-xs font-mono">
              <button
                onClick={() => setView("projects")}
                className={`px-3 py-1.5 transition-colors ${view === "projects" ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground"}`}
              >
                Deployments
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
              <option value="">All Deployments</option>
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
          </>
        )}
      </div>

      <LoaderOverlay3D
        open={k8sNamespace ? k8sLoading : loading && nodes.length === 0}
        variant="project"
        title={k8sNamespace ? "Loading Kubernetes resources..." : "Mapping infrastructure..."}
      />

      <div className="flex-1 bg-card border border-border rounded-xl relative overflow-hidden">
        {k8sNamespace ? (
          <div className="absolute inset-0 overflow-auto p-4 md:p-6">
            {k8sError && (
              <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono">
                {k8sError}
              </div>
            )}

            <div className="space-y-6">
              <section>
                <h2 className="text-sm font-mono text-muted mb-3">Pods</h2>
                {k8sPods.length === 0 && !k8sLoading ? (
                  <div className="text-xs text-muted font-mono">No pods found in this namespace.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-border text-muted">
                          <th className="text-left py-2 px-3">Name</th>
                          <th className="text-left py-2 px-3">Status</th>
                          <th className="text-left py-2 px-3">Ready</th>
                          <th className="text-left py-2 px-3">Restarts</th>
                          <th className="text-left py-2 px-3">Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {k8sPods.map((pod) => (
                          <tr key={pod.name} className="border-b border-border/50 hover:bg-background/50">
                            <td className="py-2 px-3">{pod.name}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-1.5 py-0.5 rounded border ${
                                  pod.status === "Running"
                                    ? "bg-success/10 text-success border-success/30"
                                    : pod.status === "Pending"
                                      ? "bg-warning/10 text-warning border-warning/30"
                                      : "bg-error/10 text-error border-error/30"
                                }`}
                              >
                                {pod.status}
                              </span>
                            </td>
                            <td className="py-2 px-3">{pod.ready || "-"}</td>
                            <td className="py-2 px-3">{pod.restarts ?? "-"}</td>
                            <td className="py-2 px-3">{pod.age || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <h2 className="text-sm font-mono text-muted mb-3">Services</h2>
                {k8sServices.length === 0 && !k8sLoading ? (
                  <div className="text-xs text-muted font-mono">No services found in this namespace.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-border text-muted">
                          <th className="text-left py-2 px-3">Name</th>
                          <th className="text-left py-2 px-3">Type</th>
                          <th className="text-left py-2 px-3">Cluster IP</th>
                          <th className="text-left py-2 px-3">External IP</th>
                          <th className="text-left py-2 px-3">Ports</th>
                        </tr>
                      </thead>
                      <tbody>
                        {k8sServices.map((svc) => (
                          <tr key={svc.name} className="border-b border-border/50 hover:bg-background/50">
                            <td className="py-2 px-3">{svc.name}</td>
                            <td className="py-2 px-3">{svc.type}</td>
                            <td className="py-2 px-3">{svc.clusterIP || "-"}</td>
                            <td className="py-2 px-3">{svc.externalIP || "-"}</td>
                            <td className="py-2 px-3">{svc.ports || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : loading && nodes.length === 0 ? null : nodes.length === 0 ? (
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

// ── New graph builder using unified ProjectRuntime ──────

function buildProjectGraphFromRuntime(
  rt: ProjectRuntime,
  setNodes: (n: Node<TopoNodeData>[]) => void,
  setEdges: (e: Edge[]) => void,
) {
  const nodes: Node<TopoNodeData>[] = [];
  const edges: Edge[] = [];

  // Root node
  nodes.push({
    id: "host",
    type: "topoNode",
    position: { x: 0, y: 0 },
    data: {
      label: "VPS",
      type: "host",
      health: "healthy",
      sub: `${rt.projects.length} project${rt.projects.length === 1 ? "" : "s"}`,
    },
  });

  for (const proj of rt.projects) {
    const groupId = `proj-${proj.slug}`;

    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 0, y: 0 },
      data: {
        label: proj.name,
        type: "project",
        health: proj.health,
        projectSlug: proj.slug,
        projectPath: proj.path,
        serviceCount: proj.serviceCount,
        hasGit: proj.hasGit,
        childCount: proj.services.length + proj.extraContainers.length + proj.sites.length,
      },
    });
    edges.push({ id: `e-host-${groupId}`, source: "host", target: groupId, type: "smoothstep" });

    // Sites
    for (const site of proj.sites) {
      const sid = `site-${proj.slug}-${site.domain}`;
      nodes.push({
        id: sid,
        type: "topoNode",
        parentId: groupId,
        position: { x: 0, y: 0 },
        data: {
          label: site.domain,
          type: "site",
          health: site.proxy ? "healthy" : "warning",
          sub: site.proxy ? `→ ${site.proxy}` : site.root ? `root: ${site.root}` : "",
        },
      });
      edges.push({ id: `e-${groupId}-${sid}`, source: groupId, target: sid, type: "smoothstep" });
    }

    // Services → Containers
    for (const svc of proj.services) {
      const svcId = `svc-${proj.slug}-${svc.name}`;
      nodes.push({
        id: svcId,
        type: "topoNode",
        parentId: groupId,
        position: { x: 0, y: 0 },
        data: {
          label: svc.name,
          type: "service",
          health: svc.container ? "healthy" : "warning",
          image: svc.image,
          ports: svc.ports,
          sub: svc.image || "build",
        },
      });
      edges.push({ id: `e-${groupId}-${svcId}`, source: groupId, target: svcId, type: "smoothstep" });

      if (svc.container) {
        const cid = `ctr-${svc.container.name}`;
        nodes.push({
          id: cid,
          type: "topoNode",
          parentId: groupId,
          position: { x: 0, y: 0 },
          data: {
            label: svc.container.name,
            type: "container",
            health: svc.container.state === "running" ? "healthy" : "critical",
            stats: svc.container.stats,
            state: svc.container.state,
            sub: `${svc.container.state} · CPU ${svc.container.stats?.cpu || "—"}`,
          },
        });
        edges.push({ id: `e-${svcId}-${cid}`, source: svcId, target: cid, type: "smoothstep" });
      }
    }

    // Extra containers
    for (const c of proj.extraContainers) {
      const cid = `ctr-${c.name}`;
      nodes.push({
        id: cid,
        type: "topoNode",
        parentId: groupId,
        position: { x: 0, y: 0 },
        data: {
          label: c.name,
          type: "container",
          health: c.state === "running" ? "healthy" : "critical",
          stats: c.stats,
          state: c.state,
          sub: c.state,
        },
      });
      edges.push({ id: `e-${groupId}-${cid}`, source: groupId, target: cid, type: "smoothstep" });
    }
  }

  // Unclaimed containers
  if (rt.unclaimedContainers.length > 0) {
    const gid = "unclaimed";
    nodes.push({
      id: gid,
      type: "group",
      position: { x: 0, y: 0 },
      data: {
        label: "Unclaimed",
        type: "container",
        health: rt.unclaimedContainers.some(c => c.state !== "running") ? "warning" : "healthy",
        childCount: rt.unclaimedContainers.length,
      },
    });
    edges.push({ id: "e-host-unclaimed", source: "host", target: gid, type: "smoothstep" });

    for (const c of rt.unclaimedContainers) {
      const cid = `ctr-${c.name}`;
      nodes.push({
        id: cid,
        type: "topoNode",
        parentId: gid,
        position: { x: 0, y: 0 },
        data: {
          label: c.name,
          type: "container",
          health: c.state === "running" ? "healthy" : "critical",
          sub: c.state,
        },
      });
      edges.push({ id: `e-${gid}-${cid}`, source: gid, target: cid, type: "smoothstep" });
    }
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
