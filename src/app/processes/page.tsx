"use client";

import { useEffect, useState } from "react";

interface Process {
  pid: string;
  ppid: string;
  user: string;
  cpu: string;
  mem: string;
  vsz: string;
  rss: string;
  stat: string;
  command: string;
}

export default function ProcessesPage() {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/processes")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setProcesses(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Processes</h1>
        <p className="text-muted mt-1">Processes running on your VPS</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-10 bg-card border border-border rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted font-mono uppercase">
                <th className="text-left p-3">PID</th>
                <th className="text-left p-3">User</th>
                <th className="text-left p-3">CPU%</th>
                <th className="text-left p-3">MEM%</th>
                <th className="text-left p-3">VSZ</th>
                <th className="text-left p-3">RSS</th>
                <th className="text-left p-3">Stat</th>
                <th className="text-left p-3">Command</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((proc, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-background/50 transition-colors">
                  <td className="p-3 font-mono">{proc.pid}</td>
                  <td className="p-3">{proc.user}</td>
                  <td className={`p-3 font-mono ${parseFloat(proc.cpu) > 50 ? "text-error" : parseFloat(proc.cpu) > 10 ? "text-warning" : ""}`}>
                    {proc.cpu}%
                  </td>
                  <td className="p-3 font-mono">{proc.mem}%</td>
                  <td className="p-3 font-mono text-muted">{proc.vsz}</td>
                  <td className="p-3 font-mono text-muted">{proc.rss}</td>
                  <td className="p-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${proc.stat.includes("R") ? "bg-accent/10 text-accent" : "bg-border/50 text-muted"}`}>
                      {proc.stat}
                    </span>
                  </td>
                  <td className="p-3 max-w-md truncate font-mono text-muted">{proc.command}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {processes.length === 0 && (
            <p className="text-muted text-sm p-4 text-center">No processes found</p>
          )}
        </div>
      )}
    </div>
  );
}
