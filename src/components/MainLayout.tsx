"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useSidebar } from "./SidebarContext";

const sectionNames: Record<string, string> = {
  dashboard: "Overview",
  projects: "Projects",
  deployments: "Deployments",
  containers: "Runtime",
  intelligence: "Intelligence",
  alerts: "Alerts",
  templates: "Templates",
  ai: "Assistant",
  terminal: "Terminal",
  settings: "Settings",
  services: "Services",
  processes: "Processes",
  files: "Files",
  proxy: "Reverse proxy",
};

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const segment = pathname.split("/").filter(Boolean)[0] || "dashboard";
  const sectionName = sectionNames[segment] || segment.replace(/-/g, " ");

  return (
    <main
      className={`min-h-screen transition-[margin] duration-200 pb-20 md:pb-0 ${
        collapsed ? "md:ml-[72px]" : "md:ml-60"
      }`}
    >
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <span className="hidden font-mono uppercase tracking-[0.12em] text-text-dim sm:inline">GroundControl</span>
          <span className="hidden text-text-dim sm:inline">/</span>
          <span className="truncate font-medium text-muted">{sectionName}</span>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("gc:open-command-palette"))}
          className="flex h-8 min-w-8 items-center gap-2 rounded-sm border border-border bg-card px-2.5 text-muted transition-colors hover:border-accent/35 hover:text-foreground"
          aria-label="Open command palette"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden text-[11px] sm:inline">Search commands</span>
          <kbd className="hidden border-l border-border pl-2 font-mono text-[9px] text-text-dim md:inline">⌘K</kbd>
        </button>
      </header>
      <div>{children}</div>
    </main>
  );
}
