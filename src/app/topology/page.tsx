"use client";

import { useEffect, useState, useCallback } from "react";
import { type Node, type Edge } from "@xyflow/react";
import TopologyFlow from "@/components/TopologyFlow";
import XRayPanel from "@/components/XRayPanel";
import { linkSitesToContainers } from "@/lib/topology";
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
}

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
  const [xrayTarget, setXrayTarget] = useState<{
    type: "container" | "site" | "host" | "caddy" | "nginx" | "system";
    id: string;
    name: string;
    data?: any;
  } | null>(null);

  async function fetchTopology() {
    setLoading(true);
    try {
      const [projectsRes, containersRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/containers"),
      ]);

      const projects = await projectsRes.json();
      const containers: Container[] = await containersRes.json();

      const allSites: CaddySite[] = projects.caddySites || [];
      const dbProjects = projects.projects || [];
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

      const { siteGroups, unmapped } = linkSitesToContainers(
        sites,
        containers,
        siteMaps,
        dbProjects
      );

      const topoNodes: Node<TopoNodeData>[] = [];
      const topoEdges: Edge[] = [];

      // Internet
      topoNodes.push({
        id: "internet",
        type: "topoNode",
        position: { x: 0, y: 0 },
        data: { label: "Internet", type: "internet", health: "healthy" },
      });

      // Caddy
      topoNodes.push({
        id: "caddy",
        type: "topoNode",
        position: { x: 0, y: 0 },
        data: { label: "Caddy", type: "proxy", subType: "caddy", health: "healthy" },
      });
      topoEdges.push({ id: "e-internet-caddy", source: "internet", target: "caddy" });

      // Nginx (optional)
      if (hasNginx) {
        topoNodes.push({
          id: "nginx",
          type: "topoNode",
          position: { x: 0, y: 0 },
          data: { label: "Nginx", type: "proxy", subType: "nginx", health: "healthy" },
        });
        topoEdges.push({ id: "e-internet-nginx", source: "internet", target: "nginx" });
      }

      // Sites
      sites.forEach((site) => {
        const id = `site-${site.domain}`;
        topoNodes.push({
          id,
          type: "topoNode",
          position: { x: 0, y: 0 },
          data: {
            label: site.domain,
            type: "site",
            health: site.root || site.proxy ? "healthy" : "warning",
          },
        });
        topoEdges.push({ id: `e-caddy-${id}`, source: "caddy", target: id });
        if (hasNginx) {
          topoEdges.push({ id: `e-nginx-${id}`, source: "nginx", target: id });
        }
      });

      // Containers under sites
      siteGroups.forEach((group) => {
        const siteId = `site-${group.site.domain}`;
        group.containers.forEach((c) => {
          const id = `container-${c.name}`;
          topoNodes.push({
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
            },
          });
          topoEdges.push({ id: `e-${siteId}-${id}`, source: siteId, target: id });
        });
      });

      // Unmapped containers
      if (unmapped.length > 0) {
        topoNodes.push({
          id: "unmapped",
          type: "topoNode",
          position: { x: 0, y: 0 },
          data: { label: "Unmapped", type: "container", health: "unknown" },
        });
        unmapped.forEach((c) => {
          const id = `container-${c.name}`;
          topoNodes.push({
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
            },
          });
          topoEdges.push({ id: `e-unmapped-${id}`, source: "unmapped", target: id });
        });
      }

      setNodes(topoNodes);
      setEdges(topoEdges);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTopology();
    const interval = setInterval(fetchTopology, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleNodeClick = useCallback((node: Node<TopoNodeData>) => {
    const data = node.data;
    if (node.id === "unmapped") {
      setXrayTarget({ type: "system", id: "system", name: "Unmapped Containers" });
      return;
    }
    if (data.type === "container") {
      setXrayTarget({ type: "container", id: data.label, name: data.label, data: node.data });
    } else if (data.type === "site") {
      setXrayTarget({ type: "site", id: data.label, name: data.label, data: node.data });
    } else if (data.type === "proxy") {
      setXrayTarget({ type: data.subType === "nginx" ? "nginx" : "caddy", id: node.id, name: data.label, data: {} });
    }
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Topology</h1>
          <p className="text-muted mt-1">Visual map of your infrastructure and traffic flow</p>
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

      <div className="flex-1 bg-card border border-border rounded-xl relative overflow-hidden">
        {loading && nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-pulse text-muted text-sm font-mono">Mapping infrastructure...</div>
          </div>
        ) : (
          <TopologyFlow
            initialNodes={nodes}
            initialEdges={edges}
            onNodeClick={handleNodeClick}
          />
        )}
      </div>

      <XRayPanel target={xrayTarget} onClose={() => setXrayTarget(null)} />
    </div>
  );
}
