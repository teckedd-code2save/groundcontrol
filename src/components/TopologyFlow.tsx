"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { DbProject } from "@/lib/topology";

const nodeTypes = {
  topoNode: TopoNode as unknown as NodeTypes[string],
};

const NODE_WIDTH: Record<string, number> = {
  internet: 140,
  proxy: 140,
  site: 180,
  container: 200,
};

const NODE_HEIGHT: Record<string, number> = {
  internet: 40,
  proxy: 40,
  site: 40,
  container: 56,
};

export interface TopologyFilters {
  status?: "running" | "stopped" | "unhealthy" | "unknown";
  projectSlug?: string;
}

function layoutWithDagre(nodes: Node<TopoNodeData>[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80, marginx: 20, marginy: 20 });

  nodes.forEach((node) => {
    const w = NODE_WIDTH[node.data.type] || 180;
    const h = NODE_HEIGHT[node.data.type] || 40;
    g.setNode(node.id, { width: w, height: h });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const w = NODE_WIDTH[node.data.type] || 180;
    const h = NODE_HEIGHT[node.data.type] || 40;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });
}

function buildParentMap(edges: Edge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const children = map.get(edge.source) || [];
    children.push(edge.target);
    map.set(edge.source, children);
  }
  return map;
}

function getDefaultExpanded(nodes: Node<TopoNodeData>[], edges: Edge[]): Set<string> {
  const expanded = new Set<string>();
  const parentMap = buildParentMap(edges);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    if (node.data.type !== "site" && node.id !== "unmapped") continue;

    const children = parentMap.get(node.id) || [];
    const hasIssues = children.some((childId) => {
      const child = nodeMap.get(childId);
      return child && (child.data.health === "warning" || child.data.health === "critical");
    });

    if (hasIssues) {
      expanded.add(node.id);
    }
  }
  return expanded;
}

function containerMatchesFilters(
  data: TopoNodeData,
  filters: TopologyFilters,
  dbProjects: DbProject[]
): boolean {
  if (data.type !== "container") return true;

  // Status filter
  if (filters.status) {
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

  // Project filter
  if (filters.projectSlug && dbProjects.length > 0) {
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
            cName.startsWith(projSlug + "_") ||
            cName.replace(/[-_]\d+$/, "").startsWith(projSlug + "-") ||
            cName.replace(/[-_]\d+$/, "").startsWith(projSlug + "_")));

      if (!matchesProject) return false;
    }
  }

  return true;
}

interface TopologyFlowProps {
  initialNodes: Node<TopoNodeData>[];
  initialEdges: Edge[];
  filters?: TopologyFilters;
  dbProjects?: DbProject[];
  onNodeClick?: (node: Node<TopoNodeData>) => void;
}

export default function TopologyFlow({
  initialNodes,
  initialEdges,
  filters = {},
  dbProjects = [],
  onNodeClick,
}: TopologyFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopoNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance<Node<TopoNodeData>, Edge> | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => getDefaultExpanded(initialNodes, initialEdges));

  const parentMap = useMemo(() => buildParentMap(initialEdges), [initialEdges]);

  // Reset expanded when initial nodes change significantly
  useEffect(() => {
    setExpandedNodes(getDefaultExpanded(initialNodes, initialEdges));
  }, [initialNodes, initialEdges]);

  const computeVisibleNodes = useCallback(
    (allNodes: Node<TopoNodeData>[], expanded: Set<string>, activeFilters: TopologyFilters, projects: DbProject[]) => {
      const hidden = new Set<string>();

      for (const node of allNodes) {
        // Filter out containers that don't match filters
        if (!containerMatchesFilters(node.data, activeFilters, projects)) {
          hidden.add(node.id);
          continue;
        }

        // Hide container children of collapsed sites
        if (node.data.type === "container" && node.id !== "unmapped") {
          let parentId: string | null = null;
          for (const [source, targets] of parentMap.entries()) {
            if (targets.includes(node.id)) {
              parentId = source;
              break;
            }
          }
          if (parentId && !expanded.has(parentId)) {
            hidden.add(node.id);
          }
        }
      }

      // Hide unmapped children if unmapped is collapsed
      if (!expanded.has("unmapped")) {
        const unmappedChildren = parentMap.get("unmapped") || [];
        for (const childId of unmappedChildren) {
          hidden.add(childId);
        }
      }

      return allNodes.map((node) => ({
        ...node,
        hidden: hidden.has(node.id),
        data: {
          ...node.data,
          expanded:
            node.data.type === "site" || node.id === "unmapped"
              ? expanded.has(node.id)
              : undefined,
        },
      }));
    },
    [parentMap]
  );

  useEffect(() => {
    const visible = computeVisibleNodes(initialNodes, expandedNodes, filters, dbProjects);
    const laidOut = layoutWithDagre(visible, initialEdges);
    setNodes(laidOut);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, expandedNodes, filters, dbProjects, computeVisibleNodes, setNodes, setEdges]);

  useEffect(() => {
    if (rfInstance && nodes.length > 0) {
      setTimeout(() => rfInstance.fitView({ padding: 0.2, duration: 300 }), 50);
    }
  }, [rfInstance, nodes.length]);

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Inject onToggleExpand into node data
  const nodesWithToggle = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        onToggleExpand:
          node.data.type === "site" || node.id === "unmapped"
            ? () => toggleExpand(node.id)
            : undefined,
      },
    })) as Node<TopoNodeData>[];
  }, [nodes, toggleExpand]);

  const handleNodeClick = useCallback(
    (_event: any, node: Node<TopoNodeData>) => {
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  const handleInit = useCallback((instance: ReactFlowInstance<any, Edge>) => {
    setRfInstance(instance as ReactFlowInstance<Node<TopoNodeData>, Edge>);
  }, []);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodesWithToggle}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onInit={handleInit}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          style: { stroke: "#333", strokeWidth: 1, strokeDasharray: "4 4" },
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
