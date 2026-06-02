"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import XRayPanel from "@/components/XRayPanel";

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
}

interface Service {
  name: string;
  load: string;
  active: string;
  sub: string;
}

interface TopoNode {
  id: string;
  label: string;
  type: "internet" | "caddy" | "site" | "container" | "service" | "host";
  x: number;
  y: number;
  width: number;
  height: number;
  health: "healthy" | "warning" | "critical" | "unknown";
  data: any;
}

interface TopoEdge {
  from: string;
  to: string;
}

export default function TopologyPage() {
  const [nodes, setNodes] = useState<TopoNode[]>([]);
  const [edges, setEdges] = useState<TopoEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [xrayTarget, setXrayTarget] = useState<{ type: "container" | "site" | "service" | "host"; id: string; name: string; data?: any } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  const COL_WIDTH = 180;
  const NODE_HEIGHT = 44;
  const NODE_GAP = 16;
  const PADDING = 40;

  useEffect(() => {
    function onResize() {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  async function fetchTopology() {
    setLoading(true);
    try {
      const [projectsRes, containersRes, statsRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/containers"),
        fetch("/api/vps/stats"),
      ]);

      const projects = await projectsRes.json();
      const containers: Container[] = await containersRes.json();
      const stats = await statsRes.json();

      const sites: CaddySite[] = projects.caddySites || [];
      const services: Service[] = projects.services || [];

      const topoNodes: TopoNode[] = [];
      const topoEdges: TopoEdge[] = [];

      // Column positions
      const colCount = 5;
      const availableWidth = dimensions.width - PADDING * 2;
      const colStep = availableWidth / (colCount - 1);

      // Col 0: Internet
      topoNodes.push({
        id: "internet",
        label: "Internet",
        type: "internet",
        x: PADDING,
        y: dimensions.height / 2,
        width: 120,
        height: NODE_HEIGHT,
        health: "healthy",
        data: {},
      });

      // Col 1: Caddy
      const caddyY = dimensions.height / 2;
      topoNodes.push({
        id: "caddy",
        label: "Caddy",
        type: "caddy",
        x: PADDING + colStep,
        y: caddyY,
        width: 120,
        height: NODE_HEIGHT,
        health: "healthy",
        data: {},
      });
      topoEdges.push({ from: "internet", to: "caddy" });

      // Col 2: Sites
      const siteCount = Math.max(sites.length, 1);
      const siteTotalHeight = siteCount * NODE_HEIGHT + (siteCount - 1) * NODE_GAP;
      const siteStartY = (dimensions.height - siteTotalHeight) / 2;

      sites.forEach((site, i) => {
        const id = `site-${site.domain}`;
        topoNodes.push({
          id,
          label: site.domain,
          type: "site",
          x: PADDING + colStep * 2,
          y: siteStartY + i * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT / 2,
          width: 140,
          height: NODE_HEIGHT,
          health: site.root || site.proxy ? "healthy" : "warning",
          data: site,
        });
        topoEdges.push({ from: "caddy", to: id });
      });

      // Col 3: Containers
      const containerCount = Math.max(containers.length, 1);
      const containerTotalHeight = containerCount * NODE_HEIGHT + (containerCount - 1) * NODE_GAP;
      const containerStartY = (dimensions.height - containerTotalHeight) / 2;

      containers.forEach((container, i) => {
        const id = `container-${container.name}`;
        let health: TopoNode["health"] = "unknown";
        if (container.state === "running") {
          health = container.status.includes("unhealthy") ? "warning" : "healthy";
        } else {
          health = "critical";
        }

        topoNodes.push({
          id,
          label: container.name,
          type: "container",
          x: PADDING + colStep * 3,
          y: containerStartY + i * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT / 2,
          width: 140,
          height: NODE_HEIGHT,
          health,
          data: container,
        });

        // Connect sites to containers via proxy match
        sites.forEach((site) => {
          if (site.proxy && container.name.includes(site.proxy.replace(/:.*/, ""))) {
            topoEdges.push({ from: `site-${site.domain}`, to: id });
          }
        });
      });

      // Col 4: Services
      const serviceCount = Math.max(services.length, 1);
      const serviceTotalHeight = serviceCount * NODE_HEIGHT + (serviceCount - 1) * NODE_GAP;
      const serviceStartY = (dimensions.height - serviceTotalHeight) / 2;

      services.forEach((svc, i) => {
        const id = `service-${svc.name}`;
        topoNodes.push({
          id,
          label: svc.name,
          type: "service",
          x: PADDING + colStep * 4,
          y: serviceStartY + i * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT / 2,
          width: 140,
          height: NODE_HEIGHT,
          health: svc.active === "active" ? "healthy" : "unknown",
          data: svc,
        });

        // Connect containers to matching services
        containers.forEach((container) => {
          if (svc.name.toLowerCase().includes(container.name.toLowerCase()) ||
              container.name.toLowerCase().includes(svc.name.toLowerCase().replace(/\.service$/, ""))) {
            topoEdges.push({ from: `container-${container.name}`, to: id });
          }
        });
      });

      // Host node (bottom corner)
      topoNodes.push({
        id: "host",
        label: "VPS Host",
        type: "host",
        x: PADDING + colStep,
        y: dimensions.height - PADDING - NODE_HEIGHT,
        width: 120,
        height: NODE_HEIGHT,
        health: parseFloat(stats.memory?.percent || "0") > 90 || parseFloat(stats.disk?.percent || "0") > 90
          ? "warning"
          : "healthy",
        data: stats,
      });

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
  }, [dimensions]);

  function nodeColor(health: TopoNode["health"]) {
    switch (health) {
      case "healthy": return { fill: "#22c55e", stroke: "#16a34a", glow: "rgba(34,197,94,0.3)" };
      case "warning": return { fill: "#f59e0b", stroke: "#d97706", glow: "rgba(245,158,11,0.3)" };
      case "critical": return { fill: "#ef4444", stroke: "#dc2626", glow: "rgba(239,68,68,0.3)" };
      default: return { fill: "#6b7280", stroke: "#4b5563", glow: "rgba(107,114,128,0.3)" };
    }
  }

  function handleNodeClick(node: TopoNode) {
    if (node.type === "container") {
      setXrayTarget({ type: "container", id: node.data.name, name: node.data.name, data: node.data });
    } else if (node.type === "site") {
      setXrayTarget({ type: "site", id: node.data.domain, name: node.data.domain, data: node.data });
    } else if (node.type === "service") {
      setXrayTarget({ type: "service", id: node.data.name, name: node.data.name, data: node.data });
    } else if (node.type === "host") {
      setXrayTarget({ type: "host", id: "host", name: "VPS Host", data: node.data });
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Topology</h1>
          <p className="text-muted mt-1">Visual map of your infrastructure and traffic flow</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> Healthy</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> Warning</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-error" /> Critical</span>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 bg-card border border-border rounded-xl relative overflow-hidden">
        {loading && nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-pulse text-muted text-sm font-mono">Mapping infrastructure...</div>
          </div>
        ) : (
          <svg width="100%" height="100%" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#444" />
              </marker>
            </defs>

            {/* Edges */}
            {edges.map((edge, i) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              return (
                <line
                  key={i}
                  x1={from.x + from.width / 2}
                  y1={from.y}
                  x2={to.x - to.width / 2}
                  y2={to.y}
                  stroke="#333"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  markerEnd="url(#arrowhead)"
                />
              );
            })}

            {/* Animated traffic particles */}
            {edges.slice(0, 20).map((edge, i) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              return (
                <circle key={`particle-${i}`} r="2" fill="#ff5500" opacity="0.6">
                  <animateMotion
                    dur={`${2 + Math.random() * 2}s`}
                    repeatCount="indefinite"
                    path={`M${from.x + from.width / 2},${from.y} L${to.x - to.width / 2},${to.y}`}
                  />
                </circle>
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const colors = nodeColor(node.health);
              const isPulsing = node.health === "warning" || node.health === "critical";
              return (
                <g
                  key={node.id}
                  onClick={() => handleNodeClick(node)}
                  className="cursor-pointer"
                  style={{ transformOrigin: `${node.x}px ${node.y}px` }}
                >
                  {/* Glow for unhealthy */}
                  {isPulsing && (
                    <rect
                      x={node.x - node.width / 2 - 4}
                      y={node.y - node.height / 2 - 4}
                      width={node.width + 8}
                      height={node.height + 8}
                      rx={8}
                      fill="none"
                      stroke={colors.stroke}
                      strokeWidth={2}
                      opacity={0.5}
                    >
                      <animate attributeName="opacity" values="0.5;0.2;0.5" dur="2s" repeatCount="indefinite" />
                    </rect>
                  )}
                  <rect
                    x={node.x - node.width / 2}
                    y={node.y - node.height / 2}
                    width={node.width}
                    height={node.height}
                    rx={8}
                    fill="#1a1a1a"
                    stroke={colors.stroke}
                    strokeWidth={1.5}
                  />
                  <text
                    x={node.x}
                    y={node.y - 2}
                    textAnchor="middle"
                    fill="#e5e5e5"
                    fontSize="11"
                    fontFamily="monospace"
                  >
                    {node.label.length > 16 ? node.label.slice(0, 14) + "..." : node.label}
                  </text>
                  <text
                    x={node.x}
                    y={node.y + 12}
                    textAnchor="middle"
                    fill="#666"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {node.type}
                  </text>
                  {/* Status dot */}
                  <circle
                    cx={node.x + node.width / 2 - 10}
                    cy={node.y - node.height / 2 + 10}
                    r="4"
                    fill={colors.fill}
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <XRayPanel
        target={xrayTarget}
        onClose={() => setXrayTarget(null)}
      />
    </div>
  );
}
