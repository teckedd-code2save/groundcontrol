"use client";

import { useEffect, useState, useRef } from "react";
import XRayPanel from "@/components/XRayPanel";
import {
  InternetIcon,
  CaddyIcon,
  NginxIcon,
  SiteIcon,
  HostIcon,
  ContainerIcon,
  getContainerType,
} from "@/components/TopoIcons";
import { matchContainersToSite } from "@/lib/topology";

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

interface SiteGroup {
  site: CaddySite;
  containers: Container[];
}

interface UnmappedContainer {
  container: Container;
}

interface TopoNode {
  id: string;
  label: string;
  type: "internet" | "host" | "caddy" | "nginx" | "site" | "container";
  x: number;
  y: number;
  width: number;
  height: number;
  health: "healthy" | "warning" | "critical" | "unknown";
  data: any;
  summary?: { total: number; running: number; unhealthy: number };
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

// Using matchContainersToSite from @/lib/topology

function containerHealth(c: Container): TopoNode["health"] {
  if (c.state !== "running") return "critical";
  if (c.status.includes("unhealthy")) return "warning";
  return "healthy";
}

export default function TopologyPage() {
  const [nodes, setNodes] = useState<TopoNode[]>([]);
  const [edges, setEdges] = useState<TopoEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [xrayTarget, setXrayTarget] = useState<{
    type: "container" | "site" | "host" | "caddy";
    id: string;
    name: string;
    data?: any;
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  const NODE_HEIGHT = 48;
  const NODE_GAP = 28;
  const PADDING = 60;
  const HOST_PAD = 48;

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
      const services: any[] = projects.services || [];
      const sites = allSites.filter((s) => !isRawDomain(s.domain));

      // Fetch manual site→container mappings
      let siteMaps: { siteDomain: string; containerName: string }[] = [];
      try {
        const mapsRes = await fetch("/api/site-maps");
        if (mapsRes.ok) siteMaps = await mapsRes.json();
      } catch {
        // ignore
      }

      // Group containers by site using multi-strategy matching
      const usedContainers = new Set<string>();
      const siteGroups: SiteGroup[] = [];
      for (const site of sites) {
        const matched: Container[] = [];
        const matchedNames = new Set<string>();

        // Strategy 1: Manual mappings from DB
        const manual = siteMaps
          .filter((m) => m.siteDomain === site.domain)
          .map((m) => containers.find((c) => c.name === m.containerName))
          .filter(Boolean) as Container[];
        manual.forEach((c) => { matched.push(c); matchedNames.add(c.name); });

        // Strategy 2: Docker Compose project label matching
        const domainSlugs = site.domain.toLowerCase().replace(/^www\./, "").replace(/\.(com|net|org|io|dev|app|co|uk|us|de|fr|nl|be|eu|tech|cloud|space|online|store|site|blog|info|biz|ai|gh|za|ng)$/i, "").split(".");
        containers.forEach((c) => {
          if (matchedNames.has(c.name)) return;
          const proj = (c.composeProject || "").toLowerCase();
          for (const slug of domainSlugs) {
            if (slug.length > 2 && (proj === slug || proj.includes(slug) || slug.includes(proj))) {
              matched.push(c);
              matchedNames.add(c.name);
              return;
            }
          }
        });

        // Strategy 3: Heuristic matching (proxy target + domain slug)
        const heuristic = matchContainersToSite(site.domain, site.proxy, containers.filter((c) => !matchedNames.has(c.name)));
        heuristic.forEach((c) => { matched.push(c); matchedNames.add(c.name); });

        matched.forEach((c) => usedContainers.add(c.name));
        siteGroups.push({ site, containers: matched });
      }
      const unmapped = containers.filter((c) => !usedContainers.has(c.name));

      const hasNginx = services.some((s) => s.name.toLowerCase().includes("nginx"));

      const topoNodes: TopoNode[] = [];
      const topoEdges: TopoEdge[] = [];

      const W = dimensions.width;

      // Row 0: Internet (top center)
      const internetY = PADDING + NODE_HEIGHT / 2;
      topoNodes.push({
        id: "internet",
        label: "Internet",
        type: "internet",
        x: W / 2,
        y: internetY,
        width: 130,
        height: NODE_HEIGHT,
        health: "healthy",
        data: {},
      });

      // Row 1: VPS Host bounding box starts here
      const hostTop = internetY + NODE_HEIGHT / 2 + HOST_PAD;

      // Row 2: Caddy (inside host, top)
      const caddyY = hostTop + HOST_PAD + NODE_HEIGHT / 2;
      topoNodes.push({
        id: "caddy",
        label: "Caddy",
        type: "caddy",
        x: W / 2,
        y: caddyY,
        width: 130,
        height: NODE_HEIGHT,
        health: "healthy",
        data: {},
      });
      topoEdges.push({ from: "internet", to: "caddy" });

      if (hasNginx) {
        const nginxY = caddyY + NODE_HEIGHT + NODE_GAP;
        topoNodes.push({
          id: "nginx",
          label: "Nginx",
          type: "nginx",
          x: W / 2,
          y: nginxY,
          width: 130,
          height: NODE_HEIGHT,
          health: "healthy",
          data: {},
        });
        topoEdges.push({ from: "internet", to: "nginx" });
      }

      const proxyBottom = hasNginx ? caddyY + NODE_HEIGHT + NODE_GAP + NODE_HEIGHT / 2 : caddyY + NODE_HEIGHT / 2;

      // Row 3: Sites (horizontal, inside host)
      const siteY = proxyBottom + HOST_PAD;
      const siteCount = Math.max(sites.length, 1);
      const usableWidth = W - PADDING * 2 - HOST_PAD * 2;
      const siteSpacing = usableWidth / (siteCount + 1);

      sites.forEach((site, i) => {
        const id = `site-${site.domain}`;
        const x = PADDING + HOST_PAD + siteSpacing * (i + 1);
        topoNodes.push({
          id,
          label: site.domain,
          type: "site",
          x,
          y: siteY,
          width: 160,
          height: NODE_HEIGHT,
          health: site.root || site.proxy ? "healthy" : "warning",
          data: site,
        });
        topoEdges.push({ from: "caddy", to: id });
        if (hasNginx) topoEdges.push({ from: "nginx", to: id });
      });

      // Row 4: Containers under each site
      const containerStartY = siteY + NODE_HEIGHT / 2 + NODE_GAP;
      let maxContainerColumnHeight = 0;

      siteGroups.forEach((group, i) => {
        const siteX = PADDING + HOST_PAD + siteSpacing * (i + 1);
        group.containers.forEach((c, j) => {
          const id = `container-${c.name}`;
          topoNodes.push({
            id,
            label: c.name,
            type: "container",
            x: siteX,
            y: containerStartY + j * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT / 2,
            width: 160,
            height: NODE_HEIGHT,
            health: containerHealth(c),
            data: c,
          });
          topoEdges.push({ from: `site-${group.site.domain}`, to: id });
        });
        if (group.containers.length > 0) {
          maxContainerColumnHeight = Math.max(maxContainerColumnHeight, group.containers.length * (NODE_HEIGHT + NODE_GAP));
        }
      });

      // Unmapped containers on the right side
      if (unmapped.length > 0) {
        const unmappedX = W - PADDING - HOST_PAD - 80;
        const unmappedLabelY = containerStartY - NODE_GAP;
        topoNodes.push({
          id: "unmapped-label",
          label: "System",
          type: "container",
          x: unmappedX,
          y: unmappedLabelY,
          width: 120,
          height: NODE_HEIGHT,
          health: "unknown",
          data: {},
        });
        unmapped.forEach((c, j) => {
          const id = `container-${c.name}`;
          topoNodes.push({
            id,
            label: c.name,
            type: "container",
            x: unmappedX,
            y: containerStartY + j * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT / 2,
            width: 160,
            height: NODE_HEIGHT,
            health: containerHealth(c),
            data: c,
          });
          topoEdges.push({ from: "unmapped-label", to: id });
        });
        maxContainerColumnHeight = Math.max(maxContainerColumnHeight, unmapped.length * (NODE_HEIGHT + NODE_GAP));
      }

      // Host node (drawn as a background rect)
      const hostBottom = containerStartY + maxContainerColumnHeight + HOST_PAD;
      topoNodes.push({
        id: "host",
        label: "VPS Host",
        type: "host",
        x: W / 2,
        y: (hostTop + hostBottom) / 2,
        width: W - PADDING * 2,
        height: hostBottom - hostTop,
        health:
          parseFloat(stats.memory?.percent || "0") > 90 || parseFloat(stats.disk?.percent || "0") > 90
            ? "warning"
            : "healthy",
        data: stats,
      });

      // Set SVG height
      const totalHeight = hostBottom + PADDING;
      setDimensions((d) => ({ ...d, height: totalHeight }));

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
  }, [dimensions.width]);

  function handleNodeClick(node: TopoNode) {
    if (node.id === "unmapped-label") return; // System label is not clickable
    if (node.type === "container") {
      setXrayTarget({ type: "container", id: node.data.name, name: node.data.name, data: node.data });
    } else if (node.type === "site") {
      setXrayTarget({ type: "site", id: node.data.domain, name: node.data.domain, data: node.data });
    } else if (node.type === "host") {
      setXrayTarget({ type: "host", id: "host", name: "VPS Host", data: node.data });
    } else if (node.type === "caddy") {
      setXrayTarget({ type: "caddy", id: "caddy", name: "Caddy", data: {} });
    }
  }

  function NodeIcon({ type, health }: { type: TopoNode["type"]; health: TopoNode["health"] }) {
    switch (type) {
      case "internet":
        return <InternetIcon className="w-4 h-4" />;
      case "caddy":
        return <CaddyIcon className="w-4 h-4" />;
      case "nginx":
        return <NginxIcon className="w-4 h-4" />;
      case "site":
        return <SiteIcon className="w-4 h-4" />;
      case "container":
        return <ContainerIcon className="w-4 h-4" />;
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

      <div ref={containerRef} className="flex-1 bg-card border border-border rounded-xl relative overflow-auto">
        {loading && nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-pulse text-muted text-sm font-mono">Mapping infrastructure...</div>
          </div>
        ) : (
          <svg width="100%" height={dimensions.height} viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}>
            <defs>
              <marker id="arrowdown" markerWidth="8" markerHeight="6" refX="4" refY="6" orient="auto">
                <polygon points="0 0, 8 0, 4 6" fill="#555" />
              </marker>
            </defs>

            {/* Host background (drawn first so it's behind) */}
            {(() => {
              const host = nodes.find((n) => n.id === "host");
              if (!host) return null;
              return (
                <g>
                  <rect
                    x={host.x - host.width / 2}
                    y={host.y - host.height / 2}
                    width={host.width}
                    height={host.height}
                    rx={16}
                    fill="#0f0f0f"
                    stroke="#2a2a2a"
                    strokeWidth={1}
                    strokeDasharray="6 4"
                  />
                  <text
                    x={host.x - host.width / 2 + 16}
                    y={host.y - host.height / 2 + 24}
                    fill="#444"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    VPS Host
                  </text>
                </g>
              );
            })()}

            {/* Edges */}
            {edges.map((edge, i) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              return (
                <line
                  key={i}
                  x1={from.x}
                  y1={from.y + from.height / 2}
                  x2={to.x}
                  y2={to.y - to.height / 2}
                  stroke="#333"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  markerEnd="url(#arrowdown)"
                />
              );
            })}

            {/* Animated traffic particles */}
            {edges.slice(0, 20).map((edge, i) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              return (
                <circle key={`particle-${i}`} r="2" fill="#ff5500" opacity="0.5">
                  <animateMotion
                    dur={`${2 + Math.random() * 2}s`}
                    repeatCount="indefinite"
                    path={`M${from.x},${from.y + from.height / 2} L${to.x},${to.y - to.height / 2}`}
                  />
                </circle>
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              if (node.type === "host") return null; // Host is drawn as background
              const isUnhealthy = node.health === "warning" || node.health === "critical";
              const strokeColor = isUnhealthy
                ? node.health === "critical"
                  ? "#dc2626"
                  : "#d97706"
                : "#2a2a2a";
              const fillColor = "#161616";
              const statusColor = node.health === "healthy" ? "#22c55e" : node.health === "warning" ? "#f59e0b" : node.health === "critical" ? "#ef4444" : "#6b7280";

              return (
                <g
                  key={node.id}
                  onClick={() => handleNodeClick(node)}
                  className="cursor-pointer"
                >
                  {/* Soft glow for unhealthy */}
                  {isUnhealthy && (
                    <rect
                      x={node.x - node.width / 2 - 6}
                      y={node.y - node.height / 2 - 6}
                      width={node.width + 12}
                      height={node.height + 12}
                      rx={12}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={1}
                      opacity={0.3}
                    >
                      <animate attributeName="opacity" values="0.3;0.1;0.3" dur="3s" repeatCount="indefinite" />
                    </rect>
                  )}
                  <rect
                    x={node.x - node.width / 2}
                    y={node.y - node.height / 2}
                    width={node.width}
                    height={node.height}
                    rx={10}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={1}
                  />
                  {/* Icon */}
                  <foreignObject
                    x={node.x - node.width / 2 + 12}
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
                    x={node.x - node.width / 2 + 36}
                    y={node.y - 2}
                    textAnchor="start"
                    fill="#e5e5e5"
                    fontSize="11"
                    fontFamily="monospace"
                  >
                    {node.label.length > 16 ? node.label.slice(0, 14) + "..." : node.label}
                  </text>
                  {/* Subtitle */}
                  <text
                    x={node.x - node.width / 2 + 36}
                    y={node.y + 13}
                    textAnchor="start"
                    fill="#555"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {node.type === "container"
                      ? (node.data.state === "running" ? "running" : node.data.state)
                      : node.type}
                  </text>
                  {/* Status dot */}
                  <circle
                    cx={node.x + node.width / 2 - 12}
                    cy={node.y}
                    r="4"
                    fill={statusColor}
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
