"use client";

import { useEffect, useState } from "react";

interface CaddySite {
  file: string;
  domain: string;
  root: string | null;
  proxy: string | null;
  content: string;
}

interface Service {
  name: string;
  load: string;
  active: string;
  sub: string;
}

export default function ProjectsPage() {
  const [data, setData] = useState<{
    directories: string[];
    caddySites: CaddySite[];
    services: Service[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <p className="text-muted mt-1">Everything running on your VPS</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-card border border-border rounded-xl" />
          <div className="h-48 bg-card border border-border rounded-xl" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Caddy Sites */}
          <section>
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Caddy Sites</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data?.caddySites.map((site) => (
                <div
                  key={site.domain}
                  className="bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-colors"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-medium text-accent">{site.domain}</div>
                    <div className="text-xs text-muted font-mono">{site.file}</div>
                  </div>
                  {site.root && (
                    <div className="text-xs font-mono text-muted mb-1">
                      root: {site.root}
                    </div>
                  )}
                  {site.proxy && (
                    <div className="text-xs font-mono text-muted mb-1">
                      proxy: {site.proxy}
                    </div>
                  )}
                  <pre className="mt-3 text-[10px] font-mono text-muted bg-background/50 p-3 rounded-lg overflow-auto max-h-32 scrollbar-thin">
                    {site.content}
                  </pre>
                </div>
              ))}
              {data?.caddySites.length === 0 && (
                <p className="text-muted text-sm">No Caddy sites found</p>
              )}
            </div>
          </section>

          {/* /opt/ Directories */}
          <section>
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">
              /opt/ Directories
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {data?.directories.map((dir) => (
                <div
                  key={dir}
                  className="bg-card border border-border rounded-lg p-3 text-center hover:border-border-hover transition-colors"
                >
                  <div className="text-xs font-mono text-foreground">{dir}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Systemd Services */}
          <section>
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">
              Systemd Services
            </h2>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted text-xs font-mono uppercase">
                    <th className="text-left p-4">Service</th>
                    <th className="text-left p-4">Load</th>
                    <th className="text-left p-4">Active</th>
                    <th className="text-left p-4">Sub</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.services.map((svc) => (
                    <tr
                      key={svc.name}
                      className="border-b border-border/50 hover:bg-background/50 transition-colors"
                    >
                      <td className="p-4 font-mono text-xs">{svc.name}</td>
                      <td className="p-4">
                        <span
                          className={`text-xs ${
                            svc.load === "loaded" ? "text-success" : "text-warning"
                          }`}
                        >
                          {svc.load}
                        </span>
                      </td>
                      <td className="p-4">
                        <span
                          className={`text-xs ${
                            svc.active === "active" ? "text-success" : "text-muted"
                          }`}
                        >
                          {svc.active}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-muted">{svc.sub}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data?.services.length === 0 && (
                <p className="text-muted text-sm p-4 text-center">No services found</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
