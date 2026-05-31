"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";

interface DeployLog {
  id: number;
  projectSlug: string;
  status: string;
  branch: string;
  output: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

const projects = [
  { slug: "rentaweekend", name: "Rent My Weekend", domain: "rentmyweekend.serendepify.com" },
  { slug: "urbanize", name: "Urbanize", domain: "urbanize.serendepify.com" },
  { slug: "perfume-emporio", name: "Perfume Emporio", domain: "perfumeemporium.serendepify.com" },
  { slug: "optimi", name: "Optimi", domain: "auridux.com" },
];

export default function DeployPage() {
  const [logs, setLogs] = useState<DeployLog[]>([]);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<DeployLog | null>(null);

  async function fetchLogs() {
    const res = await fetch("/api/deploy");
    const data = await res.json();
    setLogs(data);
  }

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  async function triggerDeploy(slug: string) {
    setDeploying(slug);
    try {
      await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, branch: "main" }),
      });
      await fetchLogs();
    } finally {
      setDeploying(null);
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Deploy</h1>
        <p className="text-muted mt-1">Trigger safe deployments using docker compose on your VPS</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {projects.map((project) => (
          <div
            key={project.slug}
            className="bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-medium">{project.name}</h3>
                <p className="text-xs text-muted font-mono mt-1">
                  <SensitiveField value={project.domain} />
                </p>
              </div>
              <button
                onClick={() => triggerDeploy(project.slug)}
                disabled={deploying === project.slug}
                className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                {deploying === project.slug ? "Deploying..." : "Deploy"}
              </button>
            </div>
            <div className="text-xs text-muted font-mono">
              /opt/{project.slug} · docker compose up -d
            </div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">
          Deployment History
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted text-xs font-mono uppercase">
                <th className="text-left p-4">Project</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Branch</th>
                <th className="text-left p-4">Duration</th>
                <th className="text-left p-4">Time</th>
                <th className="text-left p-4"></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-border/50 hover:bg-background/50 transition-colors"
                >
                  <td className="p-4 font-medium">{log.projectSlug}</td>
                  <td className="p-4">
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-mono ${
                        log.status === "success"
                          ? "bg-success/10 text-success"
                          : log.status === "failed"
                          ? "bg-error/10 text-error"
                          : log.status === "running"
                          ? "bg-accent/10 text-accent animate-pulse"
                          : "bg-warning/10 text-warning"
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="p-4 font-mono text-xs text-muted">{log.branch}</td>
                  <td className="p-4 font-mono text-xs text-muted">
                    {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="p-4 font-mono text-xs text-muted">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="text-xs font-mono text-accent hover:underline"
                    >
                      view
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && (
            <p className="text-muted text-sm p-4 text-center">No deployments yet</p>
          )}
        </div>
      </section>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
          <div className="bg-card border border-border rounded-xl w-full max-w-4xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-mono text-sm">
                Deploy: <span className="text-accent">{selectedLog.projectSlug}</span>
                <span className={`ml-3 text-xs px-2 py-0.5 rounded-full ${
                  selectedLog.status === "success"
                    ? "bg-success/10 text-success"
                    : selectedLog.status === "failed"
                    ? "bg-error/10 text-error"
                    : "bg-accent/10 text-accent"
                }`}>
                  {selectedLog.status}
                </span>
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-muted hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 font-mono text-xs space-y-4 scrollbar-thin">
              {selectedLog.output && (
                <div>
                  <div className="text-muted mb-1">stdout</div>
                  <pre className="bg-background/50 p-3 rounded-lg whitespace-pre-wrap">
                    {selectedLog.output}
                  </pre>
                </div>
              )}
              {selectedLog.error && (
                <div>
                  <div className="text-error mb-1">stderr</div>
                  <pre className="bg-error/5 p-3 rounded-lg whitespace-pre-wrap text-error/80">
                    {selectedLog.error}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
