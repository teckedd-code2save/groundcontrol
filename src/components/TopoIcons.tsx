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

export function FrontendIcon({ className = "w-5 h-5", color = "#3b82f6" }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="16" rx="2" />
      <path d="M6 8h2" />
      <path d="M6 12h8" />
      <path d="M6 16h4" />
      <path d="M2 7h20" />
    </svg>
  );
}

export function BackendIcon({ className = "w-5 h-5", color = "#22c55e" }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="8" rx="2" />
      <rect x="4" y="13" width="16" height="8" rx="2" />
      <path d="M8 7h.01" />
      <path d="M8 17h.01" />
      <path d="M12 7h4" />
      <path d="M12 17h4" />
    </svg>
  );
}

export function DatabaseIcon({ className = "w-5 h-5", color = "#f59e0b" }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

export function RedisIcon({ className = "w-5 h-5", color = "#ef4444" }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l8 4.5v6L12 17l-8-4.5v-6L12 2z" />
      <path d="M12 9l8-4.5" />
      <path d="M12 9v8" />
      <path d="M4 13.5l8 4.5" />
    </svg>
  );
}

export function InfisicalIcon({ className = "w-5 h-5", color = "#a855f7" }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <circle cx="12" cy="11" r="3" />
      <path d="M12 14v4" />
    </svg>
  );
}

export function PostgresIcon({ className = "w-5 h-5", color = "#60a5fa" }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c-4 0-7 2-7 6v7c0 3 2 5 4 5h6c2 0 4-2 4-5V9c0-4-3-6-7-6z" />
      <path d="M9 20v2" />
      <path d="M15 20v2" />
      <path d="M8 9h8" />
    </svg>
  );
}

export function MongoIcon({ className = "w-5 h-5", color = "#22c55e" }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c-2 3-3 7-3 11s2 9 3 9 3-5 3-9-1-8-3-11z" />
      <path d="M12 22v-2" />
    </svg>
  );
}

export function MysqlIcon({ className = "w-5 h-5", color = "#f97316" }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 17c-2 1-4 1-5 0-2-1-2-3-2-5 0-2 1-4 0-5-1-2-4-2-6-1" />
      <path d="M9 6c-2-1-4-1-5 1-1 2 0 4 1 6s1 4-1 6" />
      <path d="M10 6c1-1 3-1 4 0" />
      <path d="M13 10h.01" />
    </svg>
  );
}

export type ContainerKind =
  | "frontend"
  | "backend"
  | "database"
  | "redis"
  | "postgres"
  | "mongo"
  | "mysql"
  | "infisical"
  | "proxy"
  | "default";

const KIND_COLORS: Record<ContainerKind, string> = {
  frontend: "#3b82f6",
  backend: "#22c55e",
  database: "#f59e0b",
  redis: "#ef4444",
  postgres: "#60a5fa",
  mongo: "#22c55e",
  mysql: "#f97316",
  infisical: "#a855f7",
  proxy: "#c084fc",
  default: "#6b7280",
};

export function ContainerIcon({
  className = "w-5 h-5",
  type,
}: {
  className?: string;
  type?: ContainerKind;
}) {
  const color = KIND_COLORS[type || "default"];

  switch (type) {
    case "frontend":
      return <FrontendIcon className={className} color={color} />;
    case "backend":
      return <BackendIcon className={className} color={color} />;
    case "redis":
      return <RedisIcon className={className} color={color} />;
    case "postgres":
      return <PostgresIcon className={className} color={color} />;
    case "mongo":
      return <MongoIcon className={className} color={color} />;
    case "mysql":
      return <MysqlIcon className={className} color={color} />;
    case "infisical":
      return <InfisicalIcon className={className} color={color} />;
    case "database":
      return <DatabaseIcon className={className} color={color} />;
    case "proxy":
      return <CaddyIcon className={className} />;
    default:
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
}

export function getContainerType(name: string, image: string = ""): ContainerKind {
  const n = name.toLowerCase();
  const img = image.toLowerCase();
  const combined = n + " " + img;

  if (/\b(nginx|caddy|traefik|proxy|haproxy|envoy)\b/.test(combined)) return "proxy";
  if (/\bredis\b/.test(combined)) return "redis";
  if (/\b(postgres|postgresql|pg)\b/.test(combined)) return "postgres";
  if (/\bmongo\b/.test(combined)) return "mongo";
  if (/\b(mysql|mariadb)\b/.test(combined)) return "mysql";
  if (/\binfisical\b/.test(combined)) return "infisical";
  if (/\b(db|database|elasticsearch|meilisearch|sqlite)\b/.test(combined)) return "database";
  if (/\b(next|react|vue|angular|svelte|nuxt|gatsby|frontend|web|ui|app|client)\b/.test(combined)) return "frontend";
  if (/\b(api|backend|server|worker|queue|cron|job|service|nestjs|express|fastapi|django|flask|go|rust)\b/.test(combined)) return "backend";

  return "default";
}

export function getContainerTypeLabel(type: ContainerKind) {
  switch (type) {
    case "frontend": return "Frontend";
    case "backend": return "Backend";
    case "database": return "Database";
    case "redis": return "Redis";
    case "postgres": return "Postgres";
    case "mongo": return "MongoDB";
    case "mysql": return "MySQL";
    case "infisical": return "Infisical";
    case "proxy": return "Proxy";
    default: return "Container";
  }
}
