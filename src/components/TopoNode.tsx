"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import {
  InternetIcon,
  CaddyIcon,
  NginxIcon,
  SiteIcon,
  ContainerIcon,
  getContainerType,
} from "@/components/TopoIcons";

export type TopoNodeData = {
  label: string;
  type: "internet" | "proxy" | "site" | "container";
  health: "healthy" | "warning" | "critical" | "unknown";
  subType?: "caddy" | "nginx";
  stats?: { cpu: string; mem: string; pids: string };
  state?: string;
  status?: string;
  composeProject?: string;
  composeWorkingDir?: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
};

const healthColor = {
  healthy: "#22c55e",
  warning: "#f59e0b",
  critical: "#ef4444",
  unknown: "#6b7280",
};

const healthBorder = {
  healthy: "#2a2a2a",
  warning: "#d97706",
  critical: "#dc2626",
  unknown: "#2a2a2a",
};

function NodeIcon({ data }: { data: TopoNodeData }) {
  const className = "w-4 h-4";
  switch (data.type) {
    case "internet":
      return <InternetIcon className={className} />;
    case "proxy":
      return data.subType === "nginx" ? <NginxIcon className={className} /> : <CaddyIcon className={className} />;
    case "site":
      return <SiteIcon className={className} />;
    case "container":
      return <ContainerIcon className={className} type={getContainerType(data.label)} />;
    default:
      return null;
  }
}

const TopoNode = memo(function TopoNode(props: Node<TopoNodeData>) {
  const data = props.data;
  const isUnhealthy = data.health === "warning" || data.health === "critical";
  const isExpandable = data.type === "site" || (data.type === "container" && data.label === "Unmapped");

  return (
    <div
      className="group"
      style={{
        width: data.type === "container" ? 200 : data.type === "site" ? 180 : 140,
        height: data.type === "container" ? 56 : 40,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#555", width: 6, height: 6 }} />

      <div
        className="w-full h-full rounded-lg flex items-center gap-2 px-3 relative"
        style={{
          background: "#161616",
          border: `1px solid ${healthBorder[data.health]}`,
          boxShadow: isUnhealthy ? `0 0 12px ${healthColor[data.health]}22` : "none",
        }}
      >
        {/* Icon */}
        <div className="text-muted shrink-0">
          <NodeIcon data={data} />
        </div>

        {/* Label */}
        <div className="flex-1 min-w-0">
          <div
            className="text-[11px] font-mono truncate"
            style={{ color: "#e5e5e5" }}
            title={data.label}
          >
            {data.label.length > 18 ? data.label.slice(0, 16) + "..." : data.label}
          </div>
          {data.type === "container" && data.label !== "Unmapped" && (
            <div className="text-[9px] font-mono text-muted truncate">
              {data.state === "running" ? "running" : data.state} · CPU {data.stats?.cpu || "—"}
            </div>
          )}
        </div>

        {/* Expand/collapse toggle */}
        {isExpandable && data.onToggleExpand && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              data.onToggleExpand?.();
            }}
            className="text-muted hover:text-foreground text-[10px] px-1 transition-colors"
            title={data.expanded ? "Collapse" : "Expand"}
          >
            {data.expanded ? "▼" : "▶"}
          </button>
        )}

        {/* Health dot */}
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: healthColor[data.health] }}
        />
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: "#555", width: 6, height: 6 }} />
    </div>
  );
});

export default TopoNode;
