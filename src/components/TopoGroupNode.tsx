"use client";

import { memo } from "react";
import type { Node } from "@xyflow/react";
import {
  HostIcon,
  ProjectIcon,
  SiteIcon,
  CaddyIcon,
  NginxIcon,
  ContainerIcon,
} from "@/components/TopoIcons";
import type { TopoNodeData } from "./TopoNode";

const healthColor = {
  healthy: "#22c55e",
  warning: "#f59e0b",
  critical: "#ef4444",
  unknown: "#6b7280",
};

function GroupIcon({ data }: { data: TopoNodeData }) {
  const className = "w-4 h-4";
  switch (data.type) {
    case "host":
      return <HostIcon className={className} />;
    case "project":
      return <ProjectIcon className={className} />;
    case "site":
      return <SiteIcon className={className} />;
    case "proxy":
      return data.subType === "nginx" ? <NginxIcon className={className} /> : <CaddyIcon className={className} />;
    case "container":
      return <ContainerIcon className={className} />;
    default:
      return <ProjectIcon className={className} />;
  }
}

const TopoGroupNode = memo(function TopoGroupNode(props: Node<TopoNodeData>) {
  const { data } = props;
  const width = (props.width as number) || (props.style?.width as number) || 260;
  const height = (props.height as number) || (props.style?.height as number) || 120;
  const dotColor = healthColor[data.health] || healthColor.unknown;
  const expanded = data.expanded ?? true;

  return (
    <div
      className="rounded-xl border border-border/60 bg-card/80 overflow-hidden shadow-sm cursor-pointer"
      style={{ width, height }}
      title={data.onToggleExpand ? (expanded ? "Click to collapse" : "Click to expand") : data.label}
    >
      <div className="h-11 px-3 flex items-center gap-2 bg-border/30 border-b border-border/60 hover:bg-border/40">
        <div className="text-muted shrink-0">
          <GroupIcon data={data} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-mono font-medium text-foreground truncate" title={data.label}>
            {data.label}
          </span>
          {typeof data.childCount === "number" && (
            <span className="ml-2 text-[10px] font-mono text-muted tabular-nums">
              {data.childCount}
            </span>
          )}
        </div>
        {data.onToggleExpand && (
          <span
            className="text-muted hover:text-foreground text-xs px-1 select-none pointer-events-none"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▼" : "▶"}
          </span>
        )}
        {data.onNodeClick && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              data.onNodeClick?.();
            }}
            className="text-muted hover:text-accent text-[10px] px-1 transition-colors"
            title="Inspect"
            aria-label="Inspect"
          >
            ⓘ
          </button>
        )}
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
      </div>
    </div>
  );
});

export default TopoGroupNode;
