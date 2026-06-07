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

interface TopologyFlowProps {
  initialNodes: Node<TopoNodeData>[];
  initialEdges: Edge[];
  onNodeClick?: (node: Node<TopoNodeData>) => void;
}

export default function TopologyFlow({ initialNodes, initialEdges, onNodeClick }: TopologyFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopoNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance<Node<TopoNodeData>, Edge> | null>(null);

  useEffect(() => {
    const laidOut = layoutWithDagre(initialNodes, initialEdges);
    setNodes(laidOut);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  useEffect(() => {
    if (rfInstance && nodes.length > 0) {
      setTimeout(() => rfInstance.fitView({ padding: 0.2, duration: 300 }), 50);
    }
  }, [rfInstance, nodes.length]);

  const handleNodeClick = useCallback(
    (_event: any, node: Node<TopoNodeData>) => {
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

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
