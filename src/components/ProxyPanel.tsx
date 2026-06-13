"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { CaddyIcon, NginxIcon } from "@/components/TopoIcons";

interface ProxySite {
  file: string;
  content: string;
}

interface ProxyData {
  caddy: {
    active: boolean;
    version: string;
    sites: ProxySite[];
  };
  nginx: {
    active: boolean;
    version: string;
    sites: ProxySite[];
  };
}

export function ProxyPanel() {
  const [data, setData] = useState<ProxyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ server: string; output: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function fetchData() {
    try {
      const res = await fetch("/api/proxy");
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      await fetchData();
    }
    load();
  }, []);

  async function handleAction(action: string, server: string) {
    const key = `${server}-${action}`;
    setActionLoading(key);
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, server }),
      });
      const result = await res.json();
      if (action === "logs") {
        setLogs({ server, output: result.output || result.error || "No logs" });
      } else {
        alert(result.success ? "Success" : `Failed: ${result.error}`);
      }
    } finally {
      setActionLoading(null);
    }
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) {
    return <LoaderOverlay3D open variant="proxy" title="Loading proxy status..." />;
  }

  const actionServer = actionLoading ? actionLoading.split("-")[0] : "";
  const actionName = actionLoading ? actionLoading.slice(actionServer.length + 1) : "";

  return (
    <div className="space-y-10">
      <LoaderOverlay3D
        open={!!actionLoading}
        variant="proxy"
        title={actionLoading ? `${actionName} ${actionServer}...` : undefined}
      />

      {/* Caddy Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <CaddyIcon className="w-5 h-5 text-muted" />
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted">Caddy</h2>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                data?.caddy.active
                  ? "bg-success/10 text-success border border-success/30"
                  : "bg-error/10 text-error border border-error/30"
              }`}
            >
              {data?.caddy.active ? "active" : "inactive"}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleAction("test", "caddy")}
              disabled={actionLoading === "caddy-test"}
              className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
            >
              test config
            </button>
            <button
              onClick={() => handleAction("reload", "caddy")}
              disabled={actionLoading === "caddy-reload"}
              className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
            >
              reload
            </button>
            <button
              onClick={() => handleAction("logs", "caddy")}
              disabled={actionLoading === "caddy-logs"}
              className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
            >
              logs
            </button>
          </div>
        </div>

        {data?.caddy.sites.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-6 text-muted text-sm">
            No Caddy site configs found in /etc/caddy/sites/
          </div>
        ) : (
          <div className="space-y-3">
            {data?.caddy.sites.map((site, i) => {
              const key = `caddy-${i}`;
              const isExpanded = expanded.has(key);
              return (
                <div key={key} className="bg-card border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleExpand(key)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-background/30 transition-colors"
                  >
                    <span className="flex items-center gap-2 text-xs font-mono text-muted">
                      <CaddyIcon className="w-4 h-4" />
                      <SensitiveField value={site.file} />
                    </span>
                    <span className="text-xs text-muted">{isExpanded ? "▲" : "▼"}</span>
                  </button>
                  {isExpanded && (
                    <pre className="p-4 text-xs font-mono text-foreground/80 bg-background/50 overflow-auto max-h-96 scrollbar-thin whitespace-pre-wrap">
                      <SensitiveField value={site.content} />
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Nginx Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <NginxIcon className="w-5 h-5 text-muted" />
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted">Nginx</h2>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                data?.nginx.active
                  ? "bg-success/10 text-success border border-success/30"
                  : "bg-error/10 text-error border border-error/30"
              }`}
            >
              {data?.nginx.active ? "active" : "inactive"}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleAction("test", "nginx")}
              disabled={actionLoading === "nginx-test"}
              className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
            >
              test config
            </button>
            <button
              onClick={() => handleAction("reload", "nginx")}
              disabled={actionLoading === "nginx-reload"}
              className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
            >
              reload
            </button>
            <button
              onClick={() => handleAction("logs", "nginx")}
              disabled={actionLoading === "nginx-logs"}
              className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
            >
              logs
            </button>
          </div>
        </div>

        {data?.nginx.sites.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-6 text-muted text-sm">
            No Nginx site configs found
          </div>
        ) : (
          <div className="space-y-3">
            {data?.nginx.sites.map((site, i) => {
              const key = `nginx-${i}`;
              const isExpanded = expanded.has(key);
              return (
                <div key={key} className="bg-card border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleExpand(key)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-background/30 transition-colors"
                  >
                    <span className="flex items-center gap-2 text-xs font-mono text-muted">
                      <NginxIcon className="w-4 h-4" />
                      <SensitiveField value={site.file} />
                    </span>
                    <span className="text-xs text-muted">{isExpanded ? "▲" : "▼"}</span>
                  </button>
                  {isExpanded && (
                    <pre className="p-4 text-xs font-mono text-foreground/80 bg-background/50 overflow-auto max-h-96 scrollbar-thin whitespace-pre-wrap">
                      <SensitiveField value={site.content} />
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Logs Modal */}
      {logs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 md:p-8">
          <div className="bg-card border border-border rounded-xl w-full max-w-4xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-mono text-sm capitalize">
                Logs: <span className="text-accent">{logs.server}</span>
              </h3>
              <button
                onClick={() => setLogs(null)}
                className="text-muted hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>
            <pre className="flex-1 p-4 overflow-auto font-mono text-xs text-foreground/80 whitespace-pre-wrap scrollbar-thin">
              {logs.output}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
