"use client";

import React from "react";

export function InternetIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function CaddyIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

export function NginxIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v16H4z" />
      <path d="M8 8l4 8 4-8" />
      <path d="M9 12h6" />
    </svg>
  );
}

export function SiteIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M2 7h20" />
    </svg>
  );
}

export function ProjectIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 11h18" />
    </svg>
  );
}

export function ImageIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

export function ServiceIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="8" height="8" rx="1" />
      <rect x="14" y="2" width="8" height="8" rx="1" />
      <rect x="2" y="14" width="8" height="8" rx="1" />
      <rect x="14" y="14" width="8" height="8" rx="1" />
      <path d="M10 6h4" />
      <path d="M6 10v4" />
      <path d="M18 10v4" />
      <path d="M10 18h4" />
    </svg>
  );
}

export function ContainerIcon({ className = "w-5 h-5", type }: { className?: string; type?: "frontend" | "backend" | "database" | "proxy" | "default" }) {
  const colors: Record<string, string> = {
    frontend: "#3b82f6",
    backend: "#22c55e",
    database: "#f59e0b",
    proxy: "#a855f7",
    default: "#6b7280",
  };
  const color = colors[type || "default"] || colors.default;

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10V4h16v6" />
      <path d="M4 14h16" />
      <path d="M4 18h16" />
      <path d="M8 4v16" />
      <path d="M16 4v16" />
    </svg>
  );
}

export function HostIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M6 8h2" />
      <path d="M6 11h2" />
      <path d="M11 8h2" />
      <path d="M11 11h2" />
      <path d="M16 8h2" />
      <path d="M16 11h2" />
    </svg>
  );
}

export function AlertIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function getContainerType(name: string, image: string = ""): "frontend" | "backend" | "database" | "proxy" | "default" {
  const n = name.toLowerCase();
  const img = image.toLowerCase();
  const combined = n + " " + img;

  if (/\b(nginx|caddy|traefik|proxy|haproxy|envoy)\b/.test(combined)) return "proxy";
  if (/\b(db|database|postgres|mysql|mariadb|mongo|redis|elasticsearch|meilisearch|sqlite)\b/.test(combined)) return "database";
  if (/\b(next|react|vue|angular|svelte|nuxt|gatsby|frontend|web|ui|app|client)\b/.test(combined)) return "frontend";
  if (/\b(api|backend|server|worker|queue|cron|job|service|nestjs|express|fastapi|django|flask|go|rust)\b/.test(combined)) return "backend";

  return "default";
}

export function getContainerTypeLabel(type: ReturnType<typeof getContainerType>) {
  switch (type) {
    case "frontend": return "Frontend";
    case "backend": return "Backend";
    case "database": return "Database";
    case "proxy": return "Proxy";
    default: return "Container";
  }
}
