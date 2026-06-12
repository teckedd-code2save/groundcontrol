"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, startTransition, useState } from "react";
import { useSidebar } from "./SidebarContext";

interface AlertItem {
  read?: boolean;
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "◈" },
  { href: "/topology", label: "Topology", icon: "◐" },
  { href: "/services", label: "Services", icon: "◉" },
  { href: "/terminal", label: "Terminal", icon: "⌘" },
  { href: "/alerts", label: "Alerts", icon: "◑" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggleCollapsed } = useSidebar();
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch("/api/alerts")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setUnreadAlerts((data as AlertItem[]).filter((a) => !a.read).length))
      .catch(() => {});
    const interval = setInterval(() => {
      fetch("/api/alerts")
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => setUnreadAlerts((data as AlertItem[]).filter((a) => !a.read).length))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Close mobile menu on route change
  useEffect(() => {
    startTransition(() => setMobileOpen(false));
  }, [pathname]);

  if (!user) return null;

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-[60] md:hidden p-2 bg-card border border-border rounded-lg text-foreground"
        aria-label="Toggle menu"
      >
        {mobileOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        )}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[55] md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-screen bg-card border-r border-border flex flex-col z-[56] transition-all duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${collapsed ? "w-16" : "w-64"}`}
      >
        <div className={`p-4 border-b border-border flex items-center ${collapsed ? "flex-col gap-2 justify-center" : "justify-between"}`}>
          <Link href="/dashboard" className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm orb-pulse shrink-0">
              GC
            </div>
            {!collapsed && (
              <div>
                <h1 className="font-bold text-sm tracking-tight">GroundControl</h1>
                <p className="text-[10px] text-muted font-mono uppercase tracking-wider">VPS Cockpit</p>
              </div>
            )}
          </Link>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleCollapsed();
            }}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-border/50 transition-colors border border-transparent hover:border-border"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            )}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {collapsed && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleCollapsed();
              }}
              className="hidden md:flex w-full items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-mono text-accent hover:bg-accent/10 border border-accent/30 transition-colors mb-2"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>Expand</span>
            </button>
          )}
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                  collapsed ? "justify-center" : ""
                } ${
                  active
                    ? "bg-accent/10 text-accent border border-accent/30"
                    : "text-foreground/70 hover:text-foreground hover:bg-border/50 border border-transparent"
                }`}
              >
                <span className="font-mono text-xs w-5 text-center">{item.icon}</span>
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {!collapsed && item.href === "/alerts" && unreadAlerts > 0 && (
                  <span className="ml-auto text-[10px] font-mono bg-accent text-white px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                    {unreadAlerts}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-border space-y-2">
          <Link
            href="/onboarding"
            title="Add Server"
            className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors ${
              collapsed ? "" : ""
            }`}
          >
            <span>＋</span>
            {!collapsed && <span>Add Server</span>}
          </Link>

          {user && (
            <div className={`flex items-center justify-between px-3 py-2 ${collapsed ? "flex-col gap-2" : ""}`}>
              {!collapsed && <span className="text-xs font-mono text-muted">{user.username}</span>}
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.href = "/login";
                }}
                title="Logout"
                className="text-xs text-muted hover:text-error transition-colors"
              >
                {collapsed ? "⎋" : "logout"}
              </button>
            </div>
          )}
          <div className={`flex items-center gap-2 px-3 py-2 ${collapsed ? "justify-center" : ""}`}>
            <div className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
            {!collapsed && <span className="text-xs text-muted font-mono">VPS Online</span>}
          </div>
        </div>
      </aside>
    </>
  );
}
