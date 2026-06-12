"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import {
  InternetIcon,
  HostIcon,
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
  type: "internet" | "proxy" | "site" | "container" | "project" | "service" | "host" | "group";
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
  /** Group node metadata. */
  groupType?: "project" | "site" | "proxy" | "unmapped";
  childCount?: number;
  /** Secondary line shown under the label (image / path / etc.). */
  sub?: string;
};

const healthColor = {
  healthy: "#22c55e",
  warning: "#f59e0b",
  critical: "#ef4444",
  unknown: "#6b7280",
};

const healthBorderClass = {
  healthy: "border-success/30",
  warning: "border-warning/60",
  critical: "border-error/60",
  unknown: "border-border",
};

function NodeIcon({ data }: { data: TopoNodeData }) {
  const className = "w-4 h-4";
  switch (data.type) {
    case "host":
      return <HostIcon className={className} />;
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
      return <ContainerIcon className={className} type={getContainerType(data.label, data.image || "")} />;
    case "group":
      if (data.groupType === "project") return <ProjectIcon className={className} />;
      if (data.groupType === "site") return <SiteIcon className={className} />;
      if (data.groupType === "proxy") return <CaddyIcon className={className} />;
      return <ContainerIcon className={className} />;
    default:
      return null;
  }
}

const LEAF_DIMS: Record<string, { w: number; h: number }> = {
  host: { w: 160, h: 44 },
  internet: { w: 140, h: 44 },
  proxy: { w: 140, h: 44 },
  site: { w: 180, h: 48 },
  project: { w: 220, h: 56 },
  service: { w: 210, h: 56 },
  container: { w: 210, h: 60 },
};

function formatContainerSub(data: TopoNodeData): string | null {
  if (data.sub) return data.sub;
  if (data.type !== "container" || data.label === "Unmapped") return null;
  const state = data.state === "running" ? "running" : data.state || "unknown";
  const cpu = data.stats?.cpu || "—";
  const mem = data.stats?.mem || "—";
  return `${state} · CPU ${cpu} · MEM ${mem}`;
}

function secondaryLine(data: TopoNodeData): string | null {
  if (data.sub) return data.sub;
  if (data.type === "project") {
    const count = data.serviceCount ?? 0;
    return `${count} service${count === 1 ? "" : "s"}${data.hasGit ? " · git" : ""}`;
  }
  if (data.type === "service") {
    return data.image || "build";
  }
  if (data.type === "container") {
    return formatContainerSub(data);
  }
  return null;
}

function GroupNode(props: Node<TopoNodeData>) {
  const data = props.data;
  const isUnhealthy = data.health === "warning" || data.health === "critical";
  const childCount = data.childCount ?? 0;

  return (
    <div className="w-full h-full">
      <Handle type="target" position={Position.Top} style={{ background: "#555", width: 6, height: 6 }} />

      <div
        className="w-full h-full rounded-xl flex flex-col overflow-hidden"
        style={{
          background: "rgba(30,30,35,0.6)",
          border: `1px solid ${healthBorderClass[data.health].replace("border-", "").replace("/30", "30").replace("/60", "60")}`,
          boxShadow: isUnhealthy ? `0 0 16px ${healthColor[data.health]}22` : "none",
        }}
      >
        <div
          className={`flex items-center gap-2 px-3 py-2 border-b ${healthBorderClass[data.health]}`}
          style={{
            background: data.groupType === "project" ? "rgba(255,85,0,0.08)" : "rgba(100,100,110,0.12)",
          }}
        >
          <div className="text-muted shrink-0">
            <NodeIcon data={data} />
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="text-xs font-mono truncate font-medium"
              style={{ color: "#e5e5e5" }}
              title={data.label}
            >
              {data.label.length > 24 ? data.label.slice(0, 22) + "..." : data.label}
            </div>
          </div>
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: healthColor[data.health] }}
          />
        </div>

        <div className="mt-auto px-3 py-1 text-[9px] font-mono text-muted/70 flex items-center justify-between">
          <span>{childCount} item{childCount === 1 ? "" : "s"}</span>
          <span className="uppercase tracking-wider opacity-60">{data.groupType || data.type}</span>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: "#555", width: 6, height: 6 }} />
    </div>
  );
}

function LeafNode(props: Node<TopoNodeData>) {
  const data = props.data;
  const isUnhealthy = data.health === "warning" || data.health === "critical";
  const dims = LEAF_DIMS[data.type] || { w: 180, h: 44 };
  const sub = secondaryLine(data);

  return (
    <div
      className="group"
      style={{ width: dims.w, height: dims.h }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#555", width: 6, height: 6 }} />

      <div
        className={`w-full h-full rounded-lg flex items-center gap-2 px-3 relative border ${healthBorderClass[data.health]}`}
        style={{
          background: data.type === "project" ? "#1a1a22" : "#161616",
          boxShadow: isUnhealthy ? `0 0 12px ${healthColor[data.health]}22` : "none",
        }}
      >
        <div className="text-muted shrink-0">
          <NodeIcon data={data} />
        </div>

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

        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: healthColor[data.health] }}
        />
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: "#555", width: 6, height: 6 }} />
    </div>
  );
}

const TopoNode = memo(function TopoNode(props: Node<TopoNodeData>) {
  if (props.data.type === "group") {
    return <GroupNode {...props} />;
  }
  return <LeafNode {...props} />;
});

export default TopoNode;
