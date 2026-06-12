"use client";

import { useSidebar } from "./SidebarContext";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <main
      className={`min-h-screen pt-16 md:pt-0 transition-all duration-200 ${
        collapsed ? "md:ml-16" : "md:ml-64"
      }`}
    >
      {children}
    </main>
  );
}
