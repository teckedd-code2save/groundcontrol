"use client";

import { useState } from "react";

interface Job {
  name: string;
  running: boolean;
  output: string;
  error: string;
  success?: boolean;
}

const TOOLS = [
  { key: "docker", label: "Docker", desc: "Docker CE + compose plugin", route: "/api/bootstrap/docker" },
  { key: "caddy", label: "Caddy", desc: "Caddy reverse proxy", route: "/api/bootstrap/caddy" },
  { key: "cloudflared", label: "Cloudflared", desc: "Pull the cloudflared connector image", route: "/api/bootstrap/cloudflared" },
  { key: "node", label: "Node.js", desc: "Node.js 20 LTS + npm", route: "/api/bootstrap/node" },
];

export function BootstrapPanel() {
  const [jobs, setJobs] = useState<Record<string, Job>>({});

  async function run(key: string, route: string) {
    setJobs((prev) => ({
      ...prev,
      [key]: { name: key, running: true, output: "", error: "" },
    }));
    try {
      const res = await fetch(route, { method: "POST" });
      const data = await res.json();
      setJobs((prev) => ({
        ...prev,
        [key]: {
          name: key,
          running: false,
          output: data.output || "",
          error: data.error || "",
          success: data.success,
        },
      }));
    } catch (err) {
      setJobs((prev) => ({
        ...prev,
        [key]: {
          name: key,
          running: false,
          output: "",
          error: err instanceof Error ? err.message : "Network error",
          success: false,
        },
      }));
    }
  }

  return (
    <div className="space-y-8">
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-2">One-Click Install</h2>
        <p className="text-[11px] text-muted/70 mb-6 leading-relaxed">
          Install common infrastructure on the active VPS. These commands run the official installers for the detected OS.
          They are safe to re-run if a package is already installed.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TOOLS.map((tool) => {
            const job = jobs[tool.key];
            return (
              <div key={tool.key} className="border border-border rounded-xl p-4 bg-background/30">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-sm">{tool.label}</div>
                    <div className="text-[11px] text-muted mt-0.5">{tool.desc}</div>
                  </div>
                  <button
                    onClick={() => run(tool.key, tool.route)}
                    disabled={job?.running}
                    className="px-3 py-1.5 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {job?.running ? "Installing..." : "Install"}
                  </button>
                </div>
                {job && !job.running && (
                  <div className="mt-3">
                    {job.success === false && (
                      <div className="text-xs font-mono text-error mb-1">Failed: {job.error}</div>
                    )}
                    {job.success === true && (
                      <div className="text-xs font-mono text-success mb-1">Install finished</div>
                    )}
                    {(job.output || job.error) && (
                      <pre className="max-h-40 overflow-auto rounded-lg bg-background border border-border p-2 text-[10px] font-mono whitespace-pre-wrap">
                        {job.output}
                        {job.error}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
