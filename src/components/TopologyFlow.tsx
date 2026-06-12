"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type ReactFlowInstance,
  type NodeTypes,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import TopoNode, { type TopoNodeData } from "./TopoNode";
import TopoGroupNode from "./TopoGroupNode";
import type { DbProject } from "@/lib/topology";

const nodeTypes: NodeTypes = {
  topoNode: TopoNode as unknown as NodeTypes[string],
  group: TopoGroupNode as unknown as NodeTypes[string],
};

const LEAF_WIDTH: Record<string, number> = {
  host: 160,
  internet: 140,
  proxy: 140,
  site: 180,
  project: 220,
  service: 210,
  container: 210,
};

const LEAF_HEIGHT: Record<string, number> = {
  host: 44,
  internet: 44,
  proxy: 44,
  site: 48,
  project: 56,
  service: 56,
  container: 60,
};

const GROUP_PADDING_X = 24;
const GROUP_PADDING_Y = 24;
const GROUP_HEADER_HEIGHT = 36;

export interface TopologyFilters {
  status?: "running" | "stopped" | "unhealthy" | "unknown";
  projectSlug?: string;
}

function leafDimensions(data: TopoNodeData): { w: number; h: number } {
  if (data.type === "group") return { w: 180, h: 80 };
  return {
    w: LEAF_WIDTH[data.type] || 180,
    h: LEAF_HEIGHT[data.type] || 44,
  };
}

function layoutFlatWithDagre(nodes: Node<TopoNodeData>[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90, marginx: 20, marginy: 20 });

  nodes.forEach((node) => {
    const { w, h } = leafDimensions(node.data);
    g.setNode(node.id, { width: w, height: h });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const { w, h } = leafDimensions(node.data);
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
      width: w,
      height: h,
      style: { ...node.style, width: w, height: h },
    };
  });
}

function containerMatchesFilters(
  data: TopoNodeData,
  filters: TopologyFilters,
  dbProjects: DbProject[]
): boolean {
  if (filters.status && data.type === "container") {
    if (filters.status === "running") {
      if (data.state !== "running" || data.status?.includes("unhealthy")) return false;
    } else if (filters.status === "stopped") {
      if (data.state === "running") return false;
    } else if (filters.status === "unhealthy") {
      if (!data.status?.includes("unhealthy")) return false;
    } else if (filters.status === "unknown") {
      if (data.state && data.state !== "unknown") return false;
    }
  }

  if (filters.projectSlug) {
    const treeNode = data.type === "group" || data.type === "service" || data.type === "container";
    if (treeNode && data.label !== "Unmapped") {
      const nodeProj = (data.projectSlug || "").toLowerCase();
      const filterSlug = filters.projectSlug.toLowerCase();
      if (nodeProj) {
        if (nodeProj !== filterSlug) return false;
      } else if (dbProjects.length > 0) {
        const project = dbProjects.find((p) => p.slug === filters.projectSlug);
        if (project) {
          const projSlug = project.slug.toLowerCase();
          const projPath = (project.path || "").toLowerCase().replace(/\/$/, "");
          const composeProj = (data.composeProject || "").toLowerCase();
          const cName = data.label.toLowerCase();
          const workingDir = (data.composeWorkingDir || "").toLowerCase().replace(/\/$/, "");
          const matchesProject =
            (composeProj && (composeProj === projSlug || composeProj.includes(projSlug))) ||
            (projPath && workingDir && (workingDir === projPath || workingDir.startsWith(projPath + "/"))) ||
            (projSlug.length > 2 &&
              (cName.startsWith(projSlug + "-") ||
                cName.startsWith(projSlug + "_")));
          if (!matchesProject) return false;
        }
      }
    }
  }

  return true;
}

/**
 * After dagre lays out the flat node list (treating groups as opaque nodes),
 * wrap each group around its children and shift children to be relative to
 * the group origin.
 */
function wrapGroups(nodes: Node<TopoNodeData>[]): Node<TopoNodeData>[] {
  const childrenMap = new Map<string, Node<TopoNodeData>[]>();

  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenMap.get(node.parentId) || [];
    siblings.push(node);
    childrenMap.set(node.parentId, siblings);
  }

  const groupNodes = nodes.filter((n) => n.data.type === "group");
  const depth = new Map<string, number>();
  function computeDepth(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    const children = childrenMap.get(id) || [];
    const childGroups = children.filter((c) => c.data.type === "group");
    const d = childGroups.length === 0 ? 0 : 1 + Math.max(...childGroups.map((c) => computeDepth(c.id)));
    depth.set(id, d);
    return d;
  }
  groupNodes.forEach((g) => computeDepth(g.id));
  groupNodes.sort((a, b) => depth.get(b.id)! - depth.get(a.id)!);

  for (const group of groupNodes) {
    const children = childrenMap.get(group.id) || [];

    // Collapsed group: show only the header.
    if (children.length === 0) {
      group.width = 180;
      group.height = GROUP_HEADER_HEIGHT;
      group.style = { ...group.style, width: 180, height: GROUP_HEADER_HEIGHT };
      continue;
    }

    const childRects = children.map((child) => {
      const w = (child.width as number) || leafDimensions(child.data).w;
      const h = (child.height as number) || leafDimensions(child.data).h;
      return {
        x: child.position.x,
        y: child.position.y,
        x2: child.position.x + w,
        y2: child.position.y + h,
      };
    });

    const minX = Math.min(...childRects.map((r) => r.x));
    const minY = Math.min(...childRects.map((r) => r.y));
    const maxX = Math.max(...childRects.map((r) => r.x2));
    const maxY = Math.max(...childRects.map((r) => r.y2));

    const width = Math.max(maxX - minX + GROUP_PADDING_X * 2, 180);
    const height = maxY - minY + GROUP_PADDING_Y * 2 + GROUP_HEADER_HEIGHT;

    group.position = {
      x: minX - GROUP_PADDING_X,
      y: minY - GROUP_PADDING_Y - GROUP_HEADER_HEIGHT,
    };
    group.width = width;
    group.height = height;
    group.style = { ...group.style, width, height };

    for (const child of children) {
      child.position = {
        x: child.position.x - group.position.x,
        y: child.position.y - group.position.y,
      };
    }
  }

  return nodes;
}

interface TopologyFlowProps {
  initialNodes: Node<TopoNodeData>[];
  initialEdges: Edge[];
  filters?: TopologyFilters;
  dbProjects?: DbProject[];
}

export default function TopologyFlow({
  initialNodes,
  initialEdges,
  filters = {},
  dbProjects = [],
}: TopologyFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopoNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance<Node<TopoNodeData>, Edge> | null>(null);

  const computeVisibleNodes = useCallback(
    (allNodes: Node<TopoNodeData>[], activeFilters: TopologyFilters, projects: DbProject[]) => {
      return allNodes.map((node) => ({
        ...node,
        hidden: !containerMatchesFilters(node.data, activeFilters, projects),
      }));
    },
    []
  );

  useEffect(() => {
    const visible = computeVisibleNodes(initialNodes, filters, dbProjects);
    const nodesToLayout = visible.filter((n) => !n.hidden);
    const visibleIds = new Set(nodesToLayout.map((n) => n.id));
    const edgesToLayout = initialEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    const flatLaidOut = layoutFlatWithDagre(nodesToLayout, edgesToLayout);
    const grouped = wrapGroups(flatLaidOut);
    setNodes(grouped);
    setEdges(edgesToLayout);
  }, [initialNodes, initialEdges, filters, dbProjects, computeVisibleNodes, setNodes, setEdges]);

  useEffect(() => {
    if (rfInstance && nodes.length > 0) {
      const timer = setTimeout(() => rfInstance.fitView({ padding: 0.2, duration: 300 }), 50);
      return () => clearTimeout(timer);
    }
  }, [rfInstance, nodes.length, nodes]);

  const handleInit = useCallback((instance: ReactFlowInstance<Node<TopoNodeData>, Edge>) => {
    setRfInstance(instance);
  }, []);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={handleInit}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: "bezier",
          style: { stroke: "#333", strokeWidth: 1 },
          animated: true,
        }}
      >
        <Background color="#222" gap={20} size={1} />
        <Controls className="!bg-card !border-border !text-foreground" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor={(node) => {
            const data = node.data as TopoNodeData;
            switch (data.health) {
              case "healthy":
                return "#22c55e";
              case "warning":
                return "#f59e0b";
              case "critical":
                return "#ef4444";
              default:
                return "#6b7280";
            }
          }}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>
    </div>
  );
}
