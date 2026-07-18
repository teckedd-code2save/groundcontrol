"use client";

import { useState } from "react";
import { ModalSurface } from "@/components/ModalSurface";
import { Button, Notice } from "@/components/ui";

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
    consequence: "This will stop and start the resolved scope. A brief downtime of a few seconds may occur.",
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
    title: "Start",
    consequence: "This will bring the resolved deployment scope online using the current compose file, images, and environment.",
    severity: "neutral",
  },
  "compose-down": {
    title: "Stop",
    consequence: "This will stop the resolved deployment scope. Data in volumes is preserved.",
    severity: "warning",
  },
};

export function ActionConfirm({ open, action, targetName, targetType, onConfirm, onCancel }: ActionConfirmProps) {
  const [confirming, setConfirming] = useState(false);
  const meta = ACTION_META[action];

  const noticeTone = meta.severity === "error" ? "danger" : meta.severity;

  async function handleConfirm() {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <ModalSurface
      open={open}
      onClose={onCancel}
      title={`${meta.title} ${targetType || ""}`.trim()}
      description={targetName}
      size="sm"
      tone={meta.severity === "error" ? "danger" : "neutral"}
      footer={
        <>
          <Button onClick={onCancel} variant="quiet">Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={confirming}
            variant={meta.severity === "error" ? "danger" : "primary"}
          >
            {confirming ? "Executing…" : `Confirm ${meta.title}`}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border text-muted">
          <ActionIcon action={action} className="h-4 w-4" />
        </div>
        <Notice tone={noticeTone} title="Consequence" className="flex-1">
          {meta.consequence}
        </Notice>
      </div>
    </ModalSurface>
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
