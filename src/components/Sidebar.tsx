"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useEffect, useState, type ComponentType } from "react";
import {
  Bell,
  Boxes,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  Plus,
  Radar,
  Rocket,
  Settings,
  Sparkles,
  Terminal,
  X,
  type LucideProps,
} from "lucide-react";
import BrandLogo from "./BrandLogo";
import { useSidebar } from "./SidebarContext";

interface AlertItem { read?: boolean; }

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<LucideProps>;
  section: "observe" | "manage" | "build" | "tools" | "system";
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, section: "observe" },
  { href: "/intelligence", label: "Intelligence", icon: Radar, section: "observe" },
  { href: "/alerts", label: "Alerts", icon: Bell, section: "observe" },
  { href: "/projects", label: "Projects", icon: FolderKanban, section: "manage" },
  { href: "/deployments", label: "Deployments", icon: Rocket, section: "manage" },
  { href: "/containers", label: "Runtime", icon: Boxes, section: "manage" },
  { href: "/templates", label: "Templates", icon: LayoutTemplate, section: "build" },
  { href: "/ai", label: "Assistant", icon: Sparkles, section: "tools" },
  { href: "/terminal", label: "Terminal", icon: Terminal, section: "tools" },
  { href: "/settings", label: "Settings", icon: Settings, section: "system" },
];

const groups = [
  { key: "observe", label: "Observe" },
  { key: "manage", label: "Operate" },
  { key: "build", label: "Build" },
  { key: "tools", label: "Tools" },
] as const;

const mobileItems = navItems.filter((item) =>
  ["/dashboard", "/deployments", "/intelligence", "/settings"].includes(item.href)
);

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggleCollapsed } = useSidebar();
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    fetch("/api/auth/me").then((response) => response.ok ? response.json() : null).then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    const poll = () => fetch("/api/alerts")
      .then((response) => response.ok ? response.json() : [])
      .then((items) => setUnreadAlerts((items as AlertItem[]).filter((item) => !item.read).length))
      .catch(() => {});
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => { startTransition(() => setMobileMenu(false)); }, [pathname]);

  if (!user) return null;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <>
      <nav className="gc-sidebar fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t px-1 py-1.5 md:hidden safe-area-bottom">
        {mobileItems.map((item) => <MobileNavItem key={item.href} item={item} pathname={pathname} />)}
        <button type="button" onClick={() => setMobileMenu(true)} className="flex min-w-0 flex-col items-center gap-1 px-1 py-1.5 text-muted transition-colors hover:text-foreground">
          <Menu className="h-[18px] w-[18px]" strokeWidth={1.7} />
          <span className="text-[9px] leading-none">More</span>
        </button>
      </nav>

      {mobileMenu && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/70" onClick={() => setMobileMenu(false)} />
          <div className="gc-sidebar relative flex h-full w-[286px] flex-col border-r animate-slide-in">
            <Brand collapsed={false} close={() => setMobileMenu(false)} />
            <NavGroups pathname={pathname} unreadAlerts={unreadAlerts} collapsed={false} />
            <AccountFooter user={user.username} collapsed={false} logout={logout} />
          </div>
        </div>
      )}

      <aside className={`gc-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col border-r transition-[width] duration-200 md:flex ${collapsed ? "w-[72px]" : "w-60"}`}>
        <Brand collapsed={collapsed} toggle={toggleCollapsed} />
        <NavGroups pathname={pathname} unreadAlerts={unreadAlerts} collapsed={collapsed} />
        <div className="border-t border-border p-2">
          <Link href="/onboarding?add=1" title="Add another server" className={`flex min-h-9 items-center gap-2 rounded-sm border border-border text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-foreground ${collapsed ? "justify-center px-2" : "px-3"}`}>
            <Plus className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && <span>Add server</span>}
          </Link>
        </div>
        <AccountFooter user={user.username} collapsed={collapsed} logout={logout} />
      </aside>

      <style>{`
        @keyframes slide-in { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slide-in 180ms ease-out; }
        .safe-area-bottom { padding-bottom: max(0.375rem, env(safe-area-inset-bottom)); }
      `}</style>
    </>
  );
}

function Brand({ collapsed, toggle, close }: { collapsed: boolean; toggle?: () => void; close?: () => void }) {
  return (
    <div className={`flex h-16 shrink-0 items-center border-b border-border ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
      <Link href="/dashboard" className="flex min-w-0 items-center gap-3" aria-label="GroundControl overview">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-background">
          <BrandLogo size={21} stroke="#f1f2eb" accent="#7c9cff" />
        </span>
        {!collapsed && (
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold tracking-[-0.02em]">GroundControl</span>
            <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Self-hosted operations</span>
          </span>
        )}
      </Link>
      {close ? (
        <button type="button" onClick={close} className="gc-icon-button" aria-label="Close navigation"><X className="h-4 w-4" /></button>
      ) : !collapsed ? (
        <button type="button" onClick={toggle} className="gc-icon-button border-transparent" aria-label="Collapse navigation"><ChevronLeft className="h-4 w-4" /></button>
      ) : null}
      {collapsed && toggle && (
        <button type="button" onClick={toggle} className="absolute left-[60px] top-6 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-sidebar text-muted hover:text-foreground" aria-label="Expand navigation">
          <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function NavGroups({ pathname, unreadAlerts, collapsed }: { pathname: string; unreadAlerts: number; collapsed: boolean }) {
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-4">
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.key}>
            {!collapsed && <p className="mb-1.5 px-2 font-mono text-[9px] uppercase tracking-[0.14em] text-text-dim">{group.label}</p>}
            <div className="space-y-0.5">
              {navItems.filter((item) => item.section === group.key).map((item) => (
                <DesktopNavItem key={item.href} item={item} pathname={pathname} unreadAlerts={unreadAlerts} collapsed={collapsed} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

function DesktopNavItem({ item, pathname, unreadAlerts, collapsed }: { item: NavItem; pathname: string; unreadAlerts: number; collapsed: boolean }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link href={item.href} title={item.label} className={`relative flex min-h-9 items-center gap-3 rounded-sm px-2.5 text-[12px] transition-colors ${collapsed ? "justify-center" : ""} ${active ? "bg-white/[0.06] text-foreground" : "text-muted hover:bg-white/[0.035] hover:text-foreground"}`}>
      {active && <span className="absolute inset-y-2 left-0 w-px bg-accent" />}
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-accent" : ""}`} strokeWidth={1.65} />
      {!collapsed && <span className="flex-1">{item.label}</span>}
      {!collapsed && item.href === "/alerts" && unreadAlerts > 0 && <span className="min-w-5 rounded-full bg-error/15 px-1.5 py-0.5 text-center font-mono text-[9px] text-error">{unreadAlerts}</span>}
    </Link>
  );
}

function MobileNavItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link href={item.href} className={`flex min-w-0 flex-col items-center gap-1 px-1 py-1.5 transition-colors ${active ? "text-accent" : "text-muted hover:text-foreground"}`}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
      <span className="w-full truncate text-center text-[9px] leading-none">{item.label}</span>
    </Link>
  );
}

function AccountFooter({ user, collapsed, logout }: { user: string; collapsed: boolean; logout: () => void }) {
  return (
    <div className={`flex min-h-14 items-center border-t border-border p-2 ${collapsed ? "justify-center" : "gap-2"}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-medium uppercase text-foreground">{user.slice(0, 1)}</span>
      {!collapsed && <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{user}</span>}
      <button type="button" onClick={logout} title="Log out" className="gc-icon-button border-transparent"><LogOut className="h-3.5 w-3.5" /></button>
    </div>
  );
}
