"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, startTransition, useState } from "react";
import { useSidebar } from "./SidebarContext";

interface AlertItem { read?: boolean; }

const primaryItems = [
  { href: "/dashboard", label: "Dashboard", icon: "◈" },
  { href: "/ai", label: "Co-Pilot", icon: "◉" },
  { href: "/services", label: "Services", icon: "◎" },
  { href: "/templates", label: "Templates", icon: "▦" },
  { href: "/terminal", label: "Terminal", icon: "⌘" },
];

const secondaryItems = [
  { href: "/topology", label: "Topology", icon: "◐" },
  { href: "/guides", label: "Guides", icon: "▣" },
  { href: "/alerts", label: "Alerts", icon: "◑" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggleCollapsed } = useSidebar();
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => setUser(d)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    const poll = () => fetch("/api/alerts").then(r => r.ok ? r.json() : []).then(d => setUnreadAlerts((d as AlertItem[]).filter(a => !a.read).length)).catch(() => {});
    poll(); const iv = setInterval(poll, 30000); return () => clearInterval(iv);
  }, [user]);

  useEffect(() => { startTransition(() => setMobileMenu(false)); }, [pathname]);

  if (!user) return null;

  return (
    <>
      {/* ── Mobile: bottom tab bar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur border-t border-border flex items-center justify-around py-1.5 safe-area-bottom">
        {primaryItems.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg min-w-[56px] transition-colors ${
                active ? "text-accent" : "text-muted hover:text-foreground"
              }`}>
              <span className="text-lg">{item.icon}</span>
              <span className="text-[9px] font-mono leading-none">{item.label}</span>
            </Link>
          );
        })}
        <button onClick={() => setMobileMenu(true)}
          className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg min-w-[56px] text-muted hover:text-foreground transition-colors">
          <span className="text-lg">☰</span>
          <span className="text-[9px] font-mono leading-none">More</span>
        </button>
      </nav>

      {/* ── Mobile: full menu overlay ── */}
      {mobileMenu && (
        <div className="md:hidden fixed inset-0 z-[60] flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileMenu(false)} />
          <div className="relative w-64 bg-card border-r border-border h-full overflow-y-auto animate-slide-in">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-xs">GC</div>
                <span className="font-bold text-sm">GroundControl</span>
              </div>
              <button onClick={() => setMobileMenu(false)} className="p-1.5 rounded-lg hover:bg-border/50 text-muted hover:text-foreground transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="p-3 space-y-1">
              {[...primaryItems, ...secondaryItems].map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link key={item.href} href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      active ? "bg-accent/10 text-accent border border-accent/30" : "text-foreground/70 hover:bg-border/50 border border-transparent"
                    }`}>
                    <span className="font-mono text-sm w-5 text-center">{item.icon}</span>
                    <span>{item.label}</span>
                    {item.href === "/alerts" && unreadAlerts > 0 && (
                      <span className="ml-auto text-[10px] font-mono bg-accent text-white px-1.5 py-0.5 rounded-full">{unreadAlerts}</span>
                    )}
                  </Link>
                );
              })}
            </div>
            <div className="p-3 border-t border-border">
              <Link href="/onboarding" className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors">＋ Add Server</Link>
              <div className="flex items-center justify-between px-3 py-2 mt-2">
                <span className="text-xs font-mono text-muted">{user.username}</span>
                <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}
                  className="text-xs text-muted hover:text-error transition-colors font-mono">logout</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
      <aside className={`hidden md:flex fixed left-0 top-0 h-screen bg-card border-r border-border flex-col z-40 transition-all duration-200 ${collapsed ? "w-16" : "w-64"}`}>
        <div className={`p-4 border-b border-border flex items-center ${collapsed ? "flex-col gap-2 justify-center" : "justify-between"}`}>
          <Link href="/dashboard" className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm shrink-0">GC</div>
            {!collapsed && (
              <div>
                <h1 className="font-bold text-sm tracking-tight">GroundControl</h1>
                <p className="text-[10px] text-muted font-mono">VPS Cockpit</p>
              </div>
            )}
          </Link>
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleCollapsed(); }}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-border/50 transition-colors"
            title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            )}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {[...primaryItems, ...secondaryItems].map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href} title={item.label}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                  collapsed ? "justify-center" : ""
                } ${
                  active ? "bg-accent/10 text-accent border border-accent/30" : "text-foreground/70 hover:text-foreground hover:bg-border/50 border border-transparent"
                }`}>
                <span className="font-mono text-xs w-5 text-center">{item.icon}</span>
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {!collapsed && item.href === "/alerts" && unreadAlerts > 0 && (
                  <span className="ml-auto text-[10px] font-mono bg-accent text-white px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">{unreadAlerts}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-border space-y-2">
          <Link href="/onboarding" title="Add Server"
            className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors">
            <span>＋</span>
            {!collapsed && <span>Add Server</span>}
          </Link>
          {user && (
            <div className={`flex items-center justify-between px-3 py-2 ${collapsed ? "flex-col gap-2" : ""}`}>
              {!collapsed && <span className="text-xs font-mono text-muted">{user.username}</span>}
              <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}
                title="Logout" className="text-xs text-muted hover:text-error transition-colors">
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

      <style>{`
        @keyframes slide-in { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slide-in 0.2s ease-out; }
        .safe-area-bottom { padding-bottom: max(0.375rem, env(safe-area-inset-bottom)); }
      `}</style>
    </>
  );
}
