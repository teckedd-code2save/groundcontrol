"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Plug,
  RefreshCw,
  Shield,
} from "lucide-react";
import GithubAppPanel from "@/components/GithubAppPanel";

type ConnectorState = {
  id: string;
  name: string;
  provider: string;
  icon: "gemini" | "daytona" | "generic";
  configured: boolean;
  status: "connected" | "disconnected" | "error";
  config: Record<string, string>;
  description: string;
  purpose: string;
};

const DEFAULT_CONNECTORS: ConnectorState[] = [
  {
    id: "gemini",
    name: "Gemini",
    provider: "google",
    icon: "gemini",
    configured: false,
    status: "disconnected",
    config: { apiKey: "" },
    description: "Structured incident investigation and recovery planning.",
    purpose: "Analyses service evidence, forms hypotheses, and proposes least-disruptive recovery actions.",
  },
  {
    id: "daytona",
    name: "Daytona",
    provider: "daytona",
    icon: "daytona",
    configured: false,
    status: "disconnected",
    config: { apiKey: "", apiUrl: "https://app.daytona.io/api" },
    description: "Isolated sandbox for reproducing failures before applying fixes.",
    purpose: "Clones the exact commit, applies suspect changes, and validates fixes without touching production.",
  },
];

export default function ConnectorsPanel() {
  const [connectors, setConnectors] = useState<ConnectorState[]>(DEFAULT_CONNECTORS);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors");
      const data = await res.json();
      if (data.connectors) setConnectors(data.connectors);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(id: string) {
    const conn = connectors.find((c) => c.id === id);
    if (!conn) return;
    setEditing(id);
    setDraft({ ...conn.config });
  }

  async function save(id: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId: id, config: draft }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Save failed");
      setConnectors((prev) =>
        prev.map((c) => (c.id === id ? { ...c, config: draft, configured: true, status: "connected" } : c))
      );
      setEditing(null);
      setMessage({ tone: "success", text: `${id} connector configured.` });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(id: string) {
    setTesting(id);
    try {
      const res = await fetch("/api/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId: id }),
      });
      const data = await res.json();
      if (data.ok) {
        setConnectors((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "connected" } : c))
        );
        setMessage({ tone: "success", text: data.message || "Connection successful" });
      } else {
        setConnectors((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "error" } : c))
        );
        setMessage({ tone: "error", text: data.error || "Connection failed" });
      }
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(null);
    }
  }

  const IconComponent = ({ icon }: { icon: ConnectorState["icon"] }) => {
    switch (icon) {
      case "gemini": return <span className="text-lg">✦</span>;
      case "daytona": return <Shield className="h-5 w-5" />;
      default: return <Plug className="h-5 w-5" />;
    }
  };

  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-4">
        <h2 className="text-sm font-semibold">Connectors</h2>
        <p className="mt-1 text-xs text-muted max-w-2xl">
          Connect the systems that provide repository change evidence, investigation intelligence and isolated reproduction.
        </p>
      </div>

      <GithubAppPanel />

      {message && (
        <div className={`rounded border px-3 py-2 text-xs ${message.tone === "success" ? "border-success/30 bg-success/5 text-success" : "border-error/30 bg-error/5 text-error"}`}>
          {message.text}
        </div>
      )}

      {connectors.map((conn) => (
        <div key={conn.id} className={`border bg-card ${conn.status === "connected" ? "border-success/30" : conn.status === "error" ? "border-error/30" : "border-border"}`}>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 rounded p-1.5 ${conn.status === "connected" ? "bg-success/10 text-success" : conn.status === "error" ? "bg-error/10 text-error" : "bg-muted/10 text-muted"}`}>
                <IconComponent icon={conn.icon} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">{conn.name}</h3>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-mono ${
                    conn.status === "connected" ? "bg-success/10 text-success" : conn.status === "error" ? "bg-error/10 text-error" : "bg-warning/10 text-warning"
                  }`}>
                    {conn.status === "connected" ? "connected" : conn.status === "error" ? "error" : "not configured"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{conn.description}</p>
                <p className="mt-0.5 text-[10px] text-muted/70">{conn.purpose}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {conn.configured && (
                <button
                  onClick={() => testConnection(conn.id)}
                  disabled={testing === conn.id}
                  className="gc-button gc-button-secondary text-[10px]">
                  <RefreshCw className={`h-3 w-3 ${testing === conn.id ? "animate-spin" : ""}`} />
                  {testing === conn.id ? "Testing..." : "Test"}
                </button>
              )}
              <button
                onClick={() => editing === conn.id ? save(conn.id) : startEdit(conn.id)}
                disabled={saving}
                className={`text-[10px] px-3 py-1.5 rounded border font-mono transition-colors ${
                  editing === conn.id
                    ? "bg-accent/10 border-accent/30 text-accent"
                    : "border-border text-muted hover:border-accent/40 hover:text-accent"
                }`}>
                {editing === conn.id ? (saving ? "Saving..." : "Save") : conn.configured ? "Edit" : "Configure"}
              </button>
            </div>
          </div>

          {/* Config form */}
          {editing === conn.id && (
            <div className="border-t border-border bg-background/50 px-5 py-4">
              {conn.id === "gemini" && (
                <div className="space-y-3 max-w-lg">
                  <div>
                    <label className="block text-[10px] font-mono text-muted mb-1">API key</label>
                    <input type="password" value={draft.apiKey || ""} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                      placeholder="AIza..." className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent" />
                    <p className="mt-1 text-[10px] text-muted">Get a key from{" "}
                      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="text-accent hover:underline inline-flex items-center gap-0.5">
                        Google AI Studio <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </p>
                  </div>
                </div>
              )}

              {conn.id === "daytona" && (
                <div className="space-y-3 max-w-lg">
                  <div>
                    <label className="block text-[10px] font-mono text-muted mb-1">API URL</label>
                    <input type="text" value={draft.apiUrl || "https://app.daytona.io/api"} onChange={(e) => setDraft({ ...draft, apiUrl: e.target.value })}
                      className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-muted mb-1">API key</label>
                    <input type="password" value={draft.apiKey || ""} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                      placeholder="dtn_..." className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
