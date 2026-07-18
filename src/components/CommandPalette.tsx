"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  href?: string;
  action?: () => void;
  category: string;
}

const staticItems: CommandItem[] = [
  { id: "page-dashboard", label: "Dashboard", href: "/dashboard", category: "Pages" },
  { id: "page-projects", label: "Projects", href: "/projects", category: "Pages" },
  { id: "page-deployments", label: "Deployments", href: "/deployments", category: "Pages" },
  { id: "page-containers", label: "Runtime", href: "/containers", category: "Pages" },
  { id: "page-processes", label: "Processes", href: "/processes", category: "Pages" },
  { id: "page-files", label: "Files", href: "/files", category: "Pages" },
  { id: "page-deploy", label: "Deploy", href: "/deploy", category: "Pages" },
  { id: "page-terminal", label: "Terminal", href: "/terminal", category: "Pages" },
  { id: "page-proxy", label: "Reverse Proxy", href: "/proxy", category: "Pages" },
  { id: "page-ai", label: "AI Co-Pilot", href: "/ai", category: "Pages" },
  { id: "page-alerts", label: "Alerts", href: "/alerts", category: "Pages" },
  { id: "page-settings", label: "Settings", href: "/settings", category: "Pages" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [containers, setContainers] = useState<{ name: string; state: string }[]>([]);
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function openPalette() {
      setQuery("");
      setSelected(0);
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("gc:open-command-palette", openPalette);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("gc:open-command-palette", openPalette);
    };
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      fetch("/api/containers")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setContainers(Array.isArray(d) ? d : []))
        .catch(() => {});
      fetch("/api/projects")
        .then((r) => (r.ok ? r.json() : { directories: [] }))
        .then((d) => {
          const dirs = d.directories || [];
          setProjects(
            dirs.map((slug: string) => ({
              slug,
              name: slug.replace(/-/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
            }))
          );
        })
        .catch(() => {});
    }
  }, [open]);

  const items = useMemo(() => {
    const dynamic: CommandItem[] = [
      ...containers.map((c) => ({
        id: `container-${c.name}`,
        label: c.name,
        sublabel: c.state,
        href: "/containers",
        category: "Containers",
      })),
      ...projects.map((p) => ({
        id: `project-${p.slug}`,
        label: p.name,
        sublabel: `/opt/${p.slug}`,
        href: "/deployments",
        category: "Deployments",
      })),
    ];
    const all = [...staticItems, ...dynamic];
    const q = query.toLowerCase().trim();
    if (!q) return all;
    return all.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.sublabel && i.sublabel.toLowerCase().includes(q)) ||
        i.category.toLowerCase().includes(q)
    );
  }, [query, containers, projects]);

  const execute = useCallback(
    (item: CommandItem) => {
      if (item.action) {
        item.action();
      } else if (item.href) {
        window.location.href = item.href;
      }
      setOpen(false);
    },
    []
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selected]) execute(items[selected]);
    }
  }

  if (!open) return null;

  const grouped = items.reduce<Record<string, CommandItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/75 p-4 pt-[16vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-md border border-border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-border p-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, containers, projects..."
            className="gc-command-input flex-1 text-sm text-foreground outline-none placeholder:text-muted"
          />
          <span className="text-[10px] font-mono text-muted border border-border rounded px-1.5 py-0.5">ESC</span>
        </div>

        <div className="max-h-[50vh] overflow-auto">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">No results</div>
          ) : (
            Object.entries(grouped).map(([category, groupItems]) => (
              <div key={category}>
                <div className="border-y border-border bg-background/45 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted first:border-t-0">
                  {category}
                </div>
                {groupItems.map((item) => {
                  const globalIdx = items.findIndex((i) => i.id === item.id);
                  const isSelected = globalIdx === selected;
                  return (
                    <button
                      key={item.id}
                      onClick={() => execute(item)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                        isSelected ? "bg-accent/10 text-foreground" : "hover:bg-background/50"
                      }`}
                    >
                      <div>
                        <span className="text-sm">{item.label}</span>
                        {item.sublabel && (
                          <span className="ml-2 text-xs text-muted">{item.sublabel}</span>
                        )}
                      </div>
                      {item.href && (
                        <span className="text-[10px] text-muted font-mono">→ {item.href}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-border text-[10px] text-muted font-mono flex gap-4">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
