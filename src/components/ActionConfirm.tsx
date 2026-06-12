"use client";

import { useState } from "react";

export type ActionType = "deploy" | "start" | "stop" | "restart" | "remove" | "prune" | "reload-caddy" | "reload-nginx" | "compose-up" | "compose-down";

interface ActionConfirmProps {
  open: boolean;
  action: ActionType;
  targetName: string;
  targetType?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ACTION_META: Record<ActionType, { title: string; consequence: string; severity: "neutral" | "warning" | "error" }> = {
  deploy: {
    title: "Deploy",
    consequence: "This will pull the latest images and recreate containers. A brief downtime of a few seconds may occur while containers restart.",
    severity: "neutral",
  },
  start: {
    title: "Start",
    consequence: "This will start the container and begin serving traffic. Dependent services may need to be checked.",
    severity: "neutral",
  },
  stop: {
    title: "Stop",
    consequence: "This will stop the container. Traffic to this service will be interrupted until it is started again.",
    severity: "warning",
  },
  restart: {
    title: "Restart",
    consequence: "This will stop and start the container. A brief downtime of a few seconds will occur.",
    severity: "warning",
  },
  remove: {
    title: "Remove",
    consequence: "This will permanently delete the container and its logs. Data in volumes will be preserved, but the container itself is gone.",
    severity: "error",
  },
  prune: {
    title: "Prune Docker",
    consequence: "This will remove unused images, networks, and build cache. Active containers and volumes are not affected.",
    severity: "warning",
  },
  "reload-caddy": {
    title: "Reload Caddy",
    consequence: "This will reload the Caddy configuration. A bad config may briefly interrupt proxying.",
    severity: "neutral",
  },
  "reload-nginx": {
    title: "Reload Nginx",
    consequence: "This will reload the Nginx configuration. A bad config may briefly interrupt proxying.",
    severity: "neutral",
  },
  "compose-up": {
    title: "Compose Up",
    consequence: "This will start the selected services and recreate their containers.",
    severity: "neutral",
  },
  "compose-down": {
    title: "Compose Down",
    consequence: "This will stop and remove the selected service containers. Data in volumes is preserved.",
    severity: "warning",
  },
};

export function ActionConfirm({ open, action, targetName, targetType, onConfirm, onCancel }: ActionConfirmProps) {
  const [confirming, setConfirming] = useState(false);
  const meta = ACTION_META[action];

  if (!open) return null;

  const severityClasses = {
    neutral: "border-accent/30 text-accent",
    warning: "border-warning/30 text-warning",
    error: "border-error/30 text-error",
  };

  const bgClasses = {
    neutral: "bg-accent/10 hover:bg-accent/20",
    warning: "bg-warning/10 hover:bg-warning/20",
    error: "bg-error/10 hover:bg-error/20",
  };

  async function handleConfirm() {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${severityClasses[meta.severity]}`}>
            <ActionIcon action={action} className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-medium">{meta.title} {targetType || ""}</h3>
            <p className="text-xs text-muted mt-0.5 font-mono">{targetName}</p>
          </div>
        </div>

        <div className={`border rounded-lg p-3 mb-4 text-xs ${meta.severity === "error" ? "bg-error/5 border-error/20 text-error/80" : meta.severity === "warning" ? "bg-warning/5 border-warning/20 text-warning/80" : "bg-accent/5 border-accent/20 text-accent/80"}`}>
          <span className="font-semibold">Consequence: </span>
          {meta.consequence}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className={`px-4 py-2 text-xs font-mono border rounded-lg transition-colors disabled:opacity-50 ${severityClasses[meta.severity]} ${bgClasses[meta.severity]}`}
          >
            {confirming ? "Executing..." : `Confirm ${meta.title}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionIcon({ action, className }: { action: ActionType; className?: string }) {
  switch (action) {
    case "deploy":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case "start":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    case "stop":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      );
    case "restart":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      );
    case "remove":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case "prune":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      );
    case "reload-caddy":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
        </svg>
      );
    case "compose-up":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
          <polyline points="17 18 23 18 23 12" />
        </svg>
      );
    case "compose-down":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      );
  }
}
