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
  ProjectIcon,
  ServiceIcon,
  getContainerType,
} from "@/components/TopoIcons";

export type TopoNodeData = {
  label: string;
  type: "internet" | "proxy" | "site" | "container" | "project" | "service";
  health: "healthy" | "warning" | "critical" | "unknown";
  subType?: "caddy" | "nginx";
  stats?: { cpu: string; mem: string; pids: string };
  state?: string;
  status?: string;
  composeProject?: string;
  composeWorkingDir?: string;
  projectSlug?: string;
  /** Project node metadata. */
  projectPath?: string;
  projectParent?: string | null;
  serviceCount?: number;
  hasGit?: boolean;
  /** Service node metadata. */
  image?: string | null;
  ports?: string[];
  containerName?: string;
  /** Secondary line shown under the label (image / path / etc.). */
  sub?: string;
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
    case "project":
      return <ProjectIcon className={className} />;
    case "service":
      return <ServiceIcon className={className} />;
    case "container":
      return <ContainerIcon className={className} type={getContainerType(data.label, data.image || undefined as any)} />;
    default:
      return null;
  }
}

const NODE_DIMS: Record<string, { w: number; h: number }> = {
  internet: { w: 140, h: 40 },
  proxy: { w: 140, h: 40 },
  site: { w: 180, h: 40 },
  project: { w: 220, h: 56 },
  service: { w: 210, h: 56 },
  container: { w: 200, h: 56 },
};

function secondaryLine(data: TopoNodeData): string | null {
  if (data.sub) return data.sub;
  if (data.type === "project") {
    const count = data.serviceCount ?? 0;
    return `${count} service${count === 1 ? "" : "s"}${data.hasGit ? " · git" : ""}`;
  }
  if (data.type === "service") {
    return data.image || "build";
  }
  if (data.type === "container" && data.label !== "Unmapped") {
    return `${data.state === "running" ? "running" : data.state} · CPU ${data.stats?.cpu || "—"}`;
  }
  return null;
}

const TopoNode = memo(function TopoNode(props: Node<TopoNodeData>) {
  const data = props.data;
  const isUnhealthy = data.health === "warning" || data.health === "critical";
  const dims = NODE_DIMS[data.type] || { w: 180, h: 40 };
  const sub = secondaryLine(data);
  const showExpand = !!data.onToggleExpand;

  return (
    <div
      className="group"
      style={{ width: dims.w, height: dims.h }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#555", width: 6, height: 6 }} />

      <div
        className="w-full h-full rounded-lg flex items-center gap-2 px-3 relative"
        style={{
          background: data.type === "project" ? "#1a1a22" : "#161616",
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
            {data.label.length > 22 ? data.label.slice(0, 20) + "..." : data.label}
          </div>
          {sub && (
            <div className="text-[9px] font-mono text-muted truncate" title={sub}>
              {sub}
            </div>
          )}
        </div>

        {/* Expand/collapse toggle */}
        {showExpand && (
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
