"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import XRayPanel from "@/components/XRayPanel";
import {
  InternetIcon,
  CaddyIcon,
  NginxIcon,
  SiteIcon,
  ServiceIcon,
  HostIcon,

} from "@/components/TopoIcons";

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

interface ServiceGroup {
  service: Service | null;
  containers: Container[];
  unmatched: boolean;
}

interface TopoNode {
  id: string;
  label: string;
  type: "internet" | "caddy" | "nginx" | "site" | "service" | "host";
  x: number;
  y: number;
  width: number;
  height: number;
  health: "healthy" | "warning" | "critical" | "unknown";
  data: any;
  summary?: {
    total: number;
    running: number;
    unhealthy: number;
  };
}

interface TopoEdge {
  from: string;
  to: string;
}

function isRawDomain(domain: string): boolean {
  if (!domain || domain === "localhost" || domain === "127.0.0.1") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return true;
  if (/^\[?::1\]?$/.test(domain)) return true;
  return false;
}

function matchContainersToService(service: Service, containers: Container[]): Container[] {
  const sName = service.name.toLowerCase().replace(/\.service$/, "");
  return containers.filter((c) => {
    const cName = c.name.toLowerCase();
    return sName.includes(cName) || cName.includes(sName);
  });
}

function buildServiceGroups(services: Service[], containers: Container[]): ServiceGroup[] {
  const usedContainers = new Set<string>();
  const groups: ServiceGroup[] = [];

  for (const svc of services) {
    const matched = matchContainersToService(svc, containers);
    matched.forEach((c) => usedContainers.add(c.name));
    groups.push({ service: svc, containers: matched, unmatched: false });
  }

  const unmatched = containers.filter((c) => !usedContainers.has(c.name));
  if (unmatched.length > 0) {
    groups.push({
      service: null,
      containers: unmatched,
      unmatched: true,
    });
  }

  return groups;
}

function serviceHealth(group: ServiceGroup): TopoNode["health"] {
  if (group.unmatched) {
    const running = group.containers.filter((c) => c.state === "running").length;
    if (running === 0 && group.containers.length > 0) return "critical";
    if (running < group.containers.length) return "warning";
    return running > 0 ? "healthy" : "unknown";
  }

  const svcHealthy = group.service?.active === "active";
  const total = group.containers.length;
  const running = group.containers.filter((c) => c.state === "running").length;
  const unhealthy = group.containers.filter((c) => c.status.includes("unhealthy")).length;

  if (total === 0) return svcHealthy ? "healthy" : "unknown";
  if (unhealthy > 0) return "warning";
  if (running === 0) return "critical";
  if (running < total) return "warning";
  return "healthy";
}

export default function TopologyPage() {
  const [nodes, setNodes] = useState<TopoNode[]>([]);
  const [edges, setEdges] = useState<TopoEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [xrayTarget, setXrayTarget] = useState<{
    type: "container" | "site" | "service" | "host";
    id: string;
    name: string;
    data?: any;
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  const COL_WIDTH = 200;
  const NODE_HEIGHT = 52;
  const NODE_GAP = 20;
  const PADDING = 48;

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

      const allSites: CaddySite[] = projects.caddySites || [];
      const services: Service[] = projects.services || [];

      // Filter out raw domains
      const sites = allSites.filter((s) => !isRawDomain(s.domain));

      const groups = buildServiceGroups(services, containers);

      const topoNodes: TopoNode[] = [];
      const topoEdges: TopoEdge[] = [];

      const colCount = 4;
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

      // Col 1: Caddy (check if nginx exists too)
      const hasNginx = services.some((s) => s.name.toLowerCase().includes("nginx"));
      const proxyCount = hasNginx ? 2 : 1;
      const proxyTotalHeight = proxyCount * NODE_HEIGHT + (proxyCount - 1) * NODE_GAP;
      const proxyStartY = (dimensions.height - proxyTotalHeight) / 2;

      topoNodes.push({
        id: "caddy",
        label: "Caddy",
        type: "caddy",
        x: PADDING + colStep,
        y: proxyStartY + NODE_HEIGHT / 2,
        width: 120,
        height: NODE_HEIGHT,
        health: "healthy",
        data: {},
      });
      topoEdges.push({ from: "internet", to: "caddy" });

      if (hasNginx) {
        topoNodes.push({
          id: "nginx",
          label: "Nginx",
          type: "nginx",
          x: PADDING + colStep,
          y: proxyStartY + NODE_HEIGHT + NODE_GAP + NODE_HEIGHT / 2,
          width: 120,
          height: NODE_HEIGHT,
          health: "healthy",
          data: {},
        });
        topoEdges.push({ from: "internet", to: "nginx" });
      }

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
          width: 150,
          height: NODE_HEIGHT,
          health: site.root || site.proxy ? "healthy" : "warning",
          data: site,
        });
        topoEdges.push({ from: "caddy", to: id });
        if (hasNginx) topoEdges.push({ from: "nginx", to: id });

        // Connect site to service group via proxy match
        groups.forEach((group, gi) => {
          if (site.proxy) {
            const proxyBase = site.proxy.replace(/:.*/, "").toLowerCase();
            const matched = group.containers.some((c) => c.name.toLowerCase().includes(proxyBase));
            if (matched) {
              topoEdges.push({ from: id, to: `svc-group-${gi}` });
            }
          }
        });
      });

      // Col 3: Services (grouped)
      const serviceCount = Math.max(groups.length, 1);
      const serviceTotalHeight = serviceCount * NODE_HEIGHT + (serviceCount - 1) * NODE_GAP;
      const serviceStartY = (dimensions.height - serviceTotalHeight) / 2;

      groups.forEach((group, i) => {
        const id = `svc-group-${i}`;
        const label = group.unmatched
          ? "Standalone"
          : group.service!.name.replace(/\.service$/, "");
        const health = serviceHealth(group);
        const total = group.containers.length;
        const running = group.containers.filter((c) => c.state === "running").length;
        const unhealthy = group.containers.filter((c) => c.status.includes("unhealthy")).length;

        topoNodes.push({
          id,
          label,
          type: "service",
          x: PADDING + colStep * 3,
          y: serviceStartY + i * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT / 2,
          width: 160,
          height: NODE_HEIGHT,
          health,
          data: { group, service: group.service },
          summary: { total, running, unhealthy },
        });

        // Connect sites to this service
        sites.forEach((site) => {
          if (site.proxy) {
            const proxyBase = site.proxy.replace(/:.*/, "").toLowerCase();
            const matched = group.containers.some((c) => c.name.toLowerCase().includes(proxyBase));
            if (matched) {
              topoEdges.push({ from: `site-${site.domain}`, to: id });
            }
          }
        });
      });

      // Host node (bottom left area, anchored under internet/caddy)
      const hostX = PADDING + colStep * 0.5;
      const hostY = dimensions.height - PADDING - NODE_HEIGHT;
      topoNodes.push({
        id: "host",
        label: "VPS Host",
        type: "host",
        x: hostX,
        y: hostY,
        width: 130,
        height: NODE_HEIGHT,
        health:
          parseFloat(stats.memory?.percent || "0") > 90 || parseFloat(stats.disk?.percent || "0") > 90
            ? "warning"
            : "healthy",
        data: stats,
      });

      // Connect host to services to show dependency
      groups.forEach((_, i) => {
        topoEdges.push({ from: "host", to: `svc-group-${i}` });
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
      case "healthy":
        return { fill: "#22c55e", stroke: "#16a34a", glow: "rgba(34,197,94,0.3)" };
      case "warning":
        return { fill: "#f59e0b", stroke: "#d97706", glow: "rgba(245,158,11,0.3)" };
      case "critical":
        return { fill: "#ef4444", stroke: "#dc2626", glow: "rgba(239,68,68,0.3)" };
      default:
        return { fill: "#6b7280", stroke: "#4b5563", glow: "rgba(107,114,128,0.3)" };
    }
  }

  function handleNodeClick(node: TopoNode) {
    if (node.type === "site") {
      setXrayTarget({ type: "site", id: node.data.domain, name: node.data.domain, data: node.data });
    } else if (node.type === "service") {
      setXrayTarget({
        type: "service",
        id: node.id,
        name: node.label,
        data: node.data,
      });
    } else if (node.type === "host") {
      setXrayTarget({ type: "host", id: "host", name: "VPS Host", data: node.data });
    }
  }

  function NodeIcon({ type, health }: { type: TopoNode["type"]; health: TopoNode["health"] }) {
    const color = health === "healthy" ? "#22c55e" : health === "warning" ? "#f59e0b" : health === "critical" ? "#ef4444" : "#888";
    switch (type) {
      case "internet":
        return <InternetIcon className="w-4 h-4" />;
      case "caddy":
        return <CaddyIcon className="w-4 h-4" />;
      case "nginx":
        return <NginxIcon className="w-4 h-4" />;
      case "site":
        return <SiteIcon className="w-4 h-4" />;
      case "service":
        return <ServiceIcon className="w-4 h-4" />;
      case "host":
        return <HostIcon className="w-4 h-4" />;
      default:
        return null;
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
                      rx={10}
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
                    rx={10}
                    fill="#1a1a1a"
                    stroke={colors.stroke}
                    strokeWidth={1.5}
                  />
                  {/* Icon */}
                  <foreignObject
                    x={node.x - node.width / 2 + 8}
                    y={node.y - 10}
                    width={20}
                    height={20}
                  >
                    <div className="flex items-center justify-center h-full text-muted">
                      <NodeIcon type={node.type} health={node.health} />
                    </div>
                  </foreignObject>
                  {/* Label */}
                  <text
                    x={node.x - node.width / 2 + 30}
                    y={node.y - 2}
                    textAnchor="start"
                    fill="#e5e5e5"
                    fontSize="11"
                    fontFamily="monospace"
                  >
                    {node.label.length > 14 ? node.label.slice(0, 12) + "..." : node.label}
                  </text>
                  {/* Type subtitle */}
                  <text
                    x={node.x - node.width / 2 + 30}
                    y={node.y + 12}
                    textAnchor="start"
                    fill="#666"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {node.type === "service" && node.summary
                      ? `${node.summary.running}/${node.summary.total} containers`
                      : node.type}
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

      <XRayPanel target={xrayTarget} onClose={() => setXrayTarget(null)} />
    </div>
  );
}
