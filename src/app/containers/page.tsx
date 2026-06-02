"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";
import { ConfirmDelete } from "@/components/ConfirmDelete";

interface Container {
  name: string;
  image: string;
  status: string;
  ports: string;
  id: string;
  state: string;
  stats?: {
    cpu: string;
    mem: string;
    net: string;
    block: string;
    pids: string;
  };
}

export default function ContainersPage() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  async function fetchContainers() {
    try {
      const res = await fetch("/api/containers");
      const data = await res.json();
      if (Array.isArray(data)) setContainers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleAction(action: "start" | "stop" | "restart" | "remove", name: string) {
    setActionLoading(name);
    try {
      await fetch("/api/containers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name }),
      });
      await fetchContainers();
    } finally {
      setActionLoading(null);
    }
  }

  async function viewLogs(name: string) {
    setSelectedContainer(name);
    try {
      const res = await fetch(`/api/containers/logs?name=${name}&tail=200`);
      const data = await res.json();
      setLogs(data.logs || "No logs available");
    } catch (err) {
      setLogs("Failed to fetch logs");
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Containers</h1>
        <p className="text-muted mt-1">Manage Docker containers on your VPS</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {containers.map((container) => (
            <div
              key={container.id}
              className="bg-card border border-border rounded-xl p-4 hover:border-border-hover transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      container.state === "running"
                        ? container.status.includes("unhealthy")
                          ? "bg-warning"
                          : "bg-success"
                        : "bg-error"
                    }`}
                  />
                  <div>
                    <div className="font-medium">{container.name}</div>
                    <div className="text-xs text-muted font-mono mt-0.5">
                      {container.image} · {container.status}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {container.stats && (
                    <div className="hidden md:flex gap-4 text-xs font-mono text-muted">
                      <span>CPU {container.stats.cpu}</span>
                      <span>MEM {container.stats.mem}</span>
                      <span>PIDs {container.stats.pids}</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => viewLogs(container.name)}
                      className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                    >
                      logs
                    </button>
                    {container.state === "running" ? (
                      <>
                        <button
                          onClick={() => handleAction("restart", container.name)}
                          disabled={actionLoading === container.name}
                          className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                        >
                          {actionLoading === container.name ? "..." : "restart"}
                        </button>
                        <button
                          onClick={() => handleAction("stop", container.name)}
                          disabled={actionLoading === container.name}
                          className="px-3 py-1.5 text-xs font-mono border border-error/30 text-error rounded hover:bg-error/10 transition-colors disabled:opacity-50"
                        >
                          stop
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleAction("start", container.name)}
                        disabled={actionLoading === container.name}
                        className="px-3 py-1.5 text-xs font-mono border border-success/30 text-success rounded hover:bg-success/10 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === container.name ? "..." : "start"}
                      </button>
                    )}
                    <button
                      onClick={() => setRemoveTarget(container.name)}
                      disabled={actionLoading === container.name}
                      className="px-3 py-1.5 text-xs font-mono border border-muted/30 text-muted rounded hover:border-error hover:text-error transition-colors disabled:opacity-50"
                    >
                      remove
                    </button>
                  </div>
                </div>
              </div>

              {container.ports && (
                <div className="mt-2 text-xs text-muted font-mono pl-7">
                  <SensitiveField value={container.ports} />
                </div>
              )}
            </div>
          ))}

          {containers.length === 0 && (
            <div className="text-center py-16 text-muted">
              <p className="text-lg">No containers found</p>
              <p className="text-sm mt-1">Docker may not be running or no containers are deployed</p>
            </div>
          )}
        </div>
      )}

      <ConfirmDelete
        open={!!removeTarget}
        resourceName={removeTarget || ""}
        resourceType="Container"
        onConfirm={() => {
          if (removeTarget) handleAction("remove", removeTarget);
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />

      {/* Logs Modal */}
      {selectedContainer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
          <div className="bg-card border border-border rounded-xl w-full max-w-4xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-mono text-sm">
                Logs: <span className="text-accent">{selectedContainer}</span>
              </h3>
              <button
                onClick={() => setSelectedContainer(null)}
                className="text-muted hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>
            <pre className="flex-1 p-4 overflow-auto font-mono text-xs text-foreground/80 whitespace-pre-wrap scrollbar-thin">
              {logs}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
