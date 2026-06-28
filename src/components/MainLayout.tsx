"use client";

import { useSidebar } from "./SidebarContext";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <main
      className={`min-h-screen transition-all duration-200 pb-20 md:pb-0 ${
        collapsed ? "md:ml-16" : "md:ml-64"
      }`}
    >
      {children}
    </main>
  );
}
