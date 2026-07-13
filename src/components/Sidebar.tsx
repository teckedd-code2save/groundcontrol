"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, startTransition, useState, type ComponentType } from "react";
import {
  LayoutDashboard,
  Sparkles,
  Boxes,
  LayoutTemplate,
  Terminal,
  Bell,
  Settings,
  Menu,
  Plus,
  ChevronLeft,
  ChevronRight,
  Radar,
  type LucideProps,
} from "lucide-react";
import { useSidebar } from "./SidebarContext";

interface AlertItem { read?: boolean; }

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<LucideProps>;
  section?: "operate" | "build" | "system";
};

const primaryItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "operate" },
  { href: "/intelligence", label: "Intelligence", icon: Radar, section: "operate" },
  { href: "/ai", label: "Co-Pilot", icon: Sparkles, section: "operate" },
  { href: "/services", label: "Services", icon: Boxes, section: "operate" },
  { href: "/templates", label: "Templates", icon: LayoutTemplate, section: "build" },
  { href: "/terminal", label: "Terminal", icon: Terminal, section: "operate" },
];

const secondaryItems: NavItem[] = [
  { href: "/alerts", label: "Alerts", icon: Bell, section: "system" },
  { href: "/settings", label: "Settings", icon: Settings, section: "system" },
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 grid grid-cols-6 bg-card/95 backdrop-blur border-t border-border py-1.5 safe-area-bottom">
        {primaryItems.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}
              className={`min-w-0 flex flex-col items-center gap-0.5 px-1 py-1 rounded-md transition-colors ${
                active ? "text-accent" : "text-muted hover:text-foreground"
              }`}>
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              <span className="w-full truncate text-center text-[8px] font-mono leading-none min-[370px]:text-[9px]">{item.label}</span>
            </Link>
          );
        })}
        <button onClick={() => setMobileMenu(true)}
          className="min-w-0 flex flex-col items-center gap-0.5 px-1 py-1 rounded-md text-muted hover:text-foreground transition-colors">
          <Menu className="h-4 w-4" strokeWidth={1.75} />
          <span className="w-full truncate text-center text-[8px] font-mono leading-none min-[370px]:text-[9px]">More</span>
        </button>
      </nav>

      {/* ── Mobile: full menu overlay ── */}
      {mobileMenu && (
        <div className="md:hidden fixed inset-0 z-[60] flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileMenu(false)} />
          <div className="relative w-64 bg-card border-r border-border h-full overflow-y-auto animate-slide-in">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-xs"><svg width="16" height="16" viewBox="0 0 64 64" fill="none"><g transform="rotate(118 32 32)"><circle cx="32" cy="32" r="21" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeDasharray="74 58"/><circle cx="32" cy="32" r="21" stroke="#E8542A" strokeWidth="6.5" strokeLinecap="round" strokeDasharray="24 200" strokeDashoffset="-80"/></g></svg></div>
                <span className="font-bold text-sm">GroundControl</span>
              </div>
              <button onClick={() => setMobileMenu(false)} className="p-1.5 rounded-lg hover:bg-border/50 text-muted hover:text-foreground transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="p-3 space-y-1">
              {[...primaryItems, ...secondaryItems].map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                      active ? "bg-accent/10 text-accent border border-accent/30" : "text-foreground/70 hover:bg-border/50 border border-transparent"
                    }`}>
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span>{item.label}</span>
                    {item.href === "/alerts" && unreadAlerts > 0 && (
                      <span className="ml-auto text-[10px] font-mono bg-accent text-white px-1.5 py-0.5 rounded-md">{unreadAlerts}</span>
                    )}
                  </Link>
                );
              })}
            </div>
            <div className="p-3 border-t border-border">
              <Link href="/onboarding?add=1" className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-md hover:bg-accent/20 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Add Server
              </Link>
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
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm shrink-0"><svg width="16" height="16" viewBox="0 0 64 64" fill="none"><g transform="rotate(118 32 32)"><circle cx="32" cy="32" r="21" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeDasharray="74 58"/><circle cx="32" cy="32" r="21" stroke="#E8542A" strokeWidth="6.5" strokeLinecap="round" strokeDasharray="24 200" strokeDashoffset="-80"/></g></svg></div>
            {!collapsed && (
              <div>
                <h1 className="font-bold text-sm tracking-tight">GroundControl</h1>
                <p className="text-[10px] text-muted font-mono">VPS Command</p>
              </div>
            )}
          </Link>
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleCollapsed(); }}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-foreground hover:bg-border/50 transition-colors"
            title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-4 overflow-y-auto">
          {(
            [
              { key: "operate", label: "Operate", items: primaryItems.filter((i) => i.section === "operate") },
              { key: "build", label: "Build", items: primaryItems.filter((i) => i.section === "build") },
              { key: "system", label: "System", items: secondaryItems },
            ] as const
          ).map((group) => (
            <div key={group.key} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pt-1 text-[10px] font-mono uppercase tracking-wider text-muted/70">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} title={item.label}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-200 ${
                      collapsed ? "justify-center" : ""
                    } ${
                      active
                        ? "bg-accent/10 text-accent border border-accent/30"
                        : "text-foreground/70 hover:text-foreground hover:bg-border/50 border border-transparent"
                    }`}>
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    {!collapsed && <span className="flex-1">{item.label}</span>}
                    {!collapsed && item.href === "/alerts" && unreadAlerts > 0 && (
                      <span className="ml-auto text-[10px] font-mono bg-accent text-white px-1.5 py-0.5 rounded-md min-w-[1.25rem] text-center">{unreadAlerts}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-2 border-t border-border space-y-2">
          <Link href="/onboarding?add=1" title="Add another VPS"
            className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-md hover:bg-accent/20 transition-colors">
            <Plus className="h-3.5 w-3.5" />
            {!collapsed && <span>Add Server</span>}
          </Link>
          {user && (
            <div className={`flex items-center justify-between px-3 py-2 ${collapsed ? "flex-col gap-2" : ""}`}>
              {!collapsed && <span className="text-xs font-mono text-muted truncate">{user.username}</span>}
              <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}
                title="Logout" className="text-xs text-muted hover:text-error transition-colors font-mono">
                {collapsed ? "out" : "logout"}
              </button>
            </div>
          )}
          <div className={`flex items-center gap-2 px-3 py-2 ${collapsed ? "justify-center" : ""}`}>
            <div className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
            {!collapsed && <span className="text-xs text-muted font-mono">Host linked</span>}
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
