"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Plug,
  RefreshCw,
  Shield,
} from "lucide-react";
import GithubAppPanel from "@/components/GithubAppPanel";
import DaytonaAcceptancePanel from "@/components/DaytonaAcceptancePanel";

type CapabilityHealth = {
  id: string;
  label: string;
  status: "healthy" | "unverified" | "degraded" | "missing_scope" | "revoked" | "unavailable" | "not_configured";
  detail: string;
  remediation?: string;
  checkedAt?: string | null;
};

type ConnectorHealth = {
  id: "github" | "daytona";
  name: string;
  status: "healthy" | "unverified" | "degraded" | "not_configured";
  configured: boolean;
  capabilities: CapabilityHealth[];
  checkedAt: string;
};

type ConnectorState = {
  id: string;
  name: string;
  provider: string;
  icon: "gemini" | "daytona" | "generic";
  configured: boolean;
  status: "configured" | "connected" | "disconnected" | "error";
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
    description: "Optional investigation model.",
    purpose: "Adds a second reasoning layer over GroundControl's operational evidence.",
  },
  {
    id: "daytona",
    name: "Daytona",
    provider: "daytona",
    icon: "daytona",
    configured: false,
    status: "disconnected",
    config: { apiKey: "", apiUrl: "https://app.daytona.io/api" },
    description: "Isolated repair sandbox.",
    purpose: "Proves the exact repository revision away from production before a source repair is promoted.",
  },
];

export default function ConnectorsPanel() {
  const [connectors, setConnectors] = useState<ConnectorState[]>(DEFAULT_CONNECTORS);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [health, setHealth] = useState<ConnectorHealth[]>([]);
  const [verifyingHealth, setVerifyingHealth] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, healthRes] = await Promise.all([
        fetch("/api/connectors"),
        fetch("/api/connectors/health", { cache: "no-store" }),
      ]);
      const [data, healthData] = await Promise.all([res.json(), healthRes.json()]);
      if (Array.isArray(data.connectors)) setConnectors(data.connectors);
      if (Array.isArray(healthData.connectors)) setHealth(healthData.connectors);
    } catch {
      // Existing connector surfaces remain usable if the health summary cannot load.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(id: string) {
    const connector = connectors.find((item) => item.id === id);
    if (!connector) return;
    setEditing(id);
    setDraft({ ...connector.config });
  }

  async function verifyCapabilities(id: "github" | "daytona") {
    setVerifyingHealth(id);
    setMessage(null);
    try {
      const response = await fetch("/api/connectors/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector: id, deep: id === "daytona" }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Capability verification failed");

      const refreshed = Array.isArray(data.connectors) ? data.connectors[0] : null;
      if (refreshed) {
        setHealth((current) => [
          ...current.filter((item) => item.id !== refreshed.id),
          refreshed,
        ]);
        setMessage({
          tone: refreshed.status === "degraded" ? "error" : "success",
          text: refreshed.status === "healthy"
            ? `${refreshed.name} capabilities verified.`
            : `${refreshed.name} verification finished: ${refreshed.status}.`,
        });
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Capability verification failed" });
    } finally {
      setVerifyingHealth(null);
    }
  }

  async function save(id: string) {
    setSaving(true);
    try {
      const response = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId: id, config: draft }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Save failed");

      setConnectors((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, config: draft, configured: true, status: "configured" }
            : item
        )
      );
      setEditing(null);
      setMessage({
        tone: "success",
        text: id === "daytona"
          ? "Daytona saved. Run Verify to prove sandbox access."
          : `${id} connector saved.`,
      });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(id: string) {
    setTesting(id);
    try {
      const response = await fetch("/api/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId: id }),
      });
      const data = await response.json();
      if (data.ok) {
        setMessage({ tone: "success", text: data.message || "Connection successful" });
      } else {
        setMessage({ tone: "error", text: data.error || "Connection failed" });
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Test failed" });
    } finally {
      setTesting(null);
    }
  }

  const daytona = connectors.find((item) => item.id === "daytona");
  const gemini = connectors.find((item) => item.id === "gemini");
  const githubHealth = health.find((item) => item.id === "github");
  const daytonaHealth = health.find((item) => item.id === "daytona");

  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-4">
        <h2 className="text-sm font-semibold">Connectors</h2>
        <p className="mt-1 max-w-2xl text-xs text-muted">
          Connect a source, an isolated sandbox, and optional investigation intelligence. GroundControl verifies capabilities separately from saved credentials.
        </p>
      </div>

      {message && (
        <div className={`rounded border px-3 py-2 text-xs ${
          message.tone === "success"
            ? "border-success/30 bg-success/5 text-success"
            : "border-error/30 bg-error/5 text-error"
        }`}>
          {message.text}
        </div>
      )}

      <ConnectorSection
        eyebrow="Source"
        title="GitHub"
        description="Repository identity, source events, repair PRs and optional private GHCR pulls."
      >
        <CapabilityStrip
          connector={githubHealth}
          verifying={verifyingHealth === "github"}
          onVerify={() => void verifyCapabilities("github")}
        />
        <GithubAppPanel />
      </ConnectorSection>

      <ConnectorSection
        eyebrow="Sandbox"
        title="Daytona"
        description="Prove a deployment's exact repository revision in an isolated environment before trusting repairs."
      >
        <CapabilityStrip
          connector={daytonaHealth}
          verifying={verifyingHealth === "daytona"}
          onVerify={() => void verifyCapabilities("daytona")}
        />
        {daytona && (
          <ConnectorConfigCard
            connector={daytona}
            editing={editing === daytona.id}
            draft={draft}
            saving={saving}
            testing={testing === daytona.id}
            onEdit={() => startEdit(daytona.id)}
            onSave={() => void save(daytona.id)}
            onTest={() => void verifyCapabilities("daytona")}
            onDraft={setDraft}
            showTest={false}
          />
        )}
        <DaytonaAcceptancePanel onVerified={load} />
      </ConnectorSection>

      <ConnectorSection
        eyebrow="Optional intelligence"
        title="Investigation model"
        description="Use GroundControl's evidence without making a model provider part of the infrastructure trust boundary."
      >
        {gemini && (
          <ConnectorConfigCard
            connector={gemini}
            editing={editing === gemini.id}
            draft={draft}
            saving={saving}
            testing={testing === gemini.id}
            onEdit={() => startEdit(gemini.id)}
            onSave={() => void save(gemini.id)}
            onTest={() => void testConnection(gemini.id)}
            onDraft={setDraft}
            showTest
          />
        )}
      </ConnectorSection>
    </div>
  );
}

function ConnectorSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-accent">{eyebrow}</p>
        <h3 className="mt-1 text-base font-semibold">{title}</h3>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function CapabilityStrip({
  connector,
  verifying,
  onVerify,
}: {
  connector?: ConnectorHealth;
  verifying: boolean;
  onVerify: () => void;
}) {
  const status = connector?.status || "not_configured";
  const statusClass = status === "healthy"
    ? "text-success"
    : status === "degraded"
      ? "text-error"
      : "text-warning";

  return (
    <div className="border border-border bg-background/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <p className="text-[10px] text-muted">
          Capability health <span className={`ml-1 font-mono ${statusClass}`}>{status}</span>
        </p>
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className="gc-button gc-button-quiet text-[10px]"
        >
          <RefreshCw className={`h-3 w-3 ${verifying ? "animate-spin" : ""}`} />
          {verifying ? "Verifying…" : "Verify"}
        </button>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3">
        {(connector?.capabilities || []).map((capability) => {
          const unhealthy = capability.status !== "healthy";
          return (
            <div key={capability.id} className="border-b border-border px-4 py-3 last:border-b-0 sm:border-r">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-medium">{capability.label}</span>
                <span className={`font-mono text-[8px] ${
                  capability.status === "healthy"
                    ? "text-success"
                    : ["degraded", "revoked", "missing_scope", "unavailable"].includes(capability.status)
                      ? "text-error"
                      : "text-warning"
                }`}>
                  {capability.status}
                </span>
              </div>
              {unhealthy && (
                <p className="mt-1.5 text-[9px] leading-relaxed text-muted">
                  {capability.remediation || capability.detail}
                </p>
              )}
            </div>
          );
        })}
        {!connector && <p className="px-4 py-4 text-[10px] text-muted">Health state has not loaded yet.</p>}
      </div>
    </div>
  );
}

function ConnectorConfigCard({
  connector,
  editing,
  draft,
  saving,
  testing,
  onEdit,
  onSave,
  onTest,
  onDraft,
  showTest,
}: {
  connector: ConnectorState;
  editing: boolean;
  draft: Record<string, string>;
  saving: boolean;
  testing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onTest: () => void;
  onDraft: (value: Record<string, string>) => void;
  showTest: boolean;
}) {
  return (
    <div className={`border bg-card ${connector.status === "error" ? "border-error/30" : "border-border"}`}>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded bg-background p-1.5 text-muted">
            {connector.icon === "gemini"
              ? <span className="text-lg">✦</span>
              : connector.icon === "daytona"
                ? <Shield className="h-5 w-5" />
                : <Plug className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium">{connector.name}</h4>
              <span className="rounded bg-muted/10 px-1.5 py-0.5 font-mono text-[8px] text-muted">
                {connector.configured ? "configured" : "not configured"}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-muted">{connector.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showTest && connector.configured && (
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              className="gc-button gc-button-secondary text-[10px]"
            >
              <RefreshCw className={`h-3 w-3 ${testing ? "animate-spin" : ""}`} />
              {testing ? "Testing…" : "Test"}
            </button>
          )}
          <button
            type="button"
            onClick={editing ? onSave : onEdit}
            disabled={saving}
            className="gc-button gc-button-quiet text-[10px]"
          >
            {editing ? (saving ? "Saving…" : "Save") : connector.configured ? "Edit" : "Configure"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="border-t border-border bg-background/50 px-5 py-4">
          {connector.id === "gemini" && (
            <div className="max-w-lg">
              <label className="mb-1 block font-mono text-[10px] text-muted">API key</label>
              <input
                type="password"
                value={draft.apiKey || ""}
                onChange={(event) => onDraft({ ...draft, apiKey: event.target.value })}
                placeholder={connector.configured ? "Leave blank to keep current key" : "AIza..."}
                className="gc-field w-full font-mono"
              />
              <p className="mt-1 text-[10px] text-muted">
                Get a key from{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                  Google AI Studio <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </p>
            </div>
          )}

          {connector.id === "daytona" && (
            <div className="grid max-w-2xl gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block font-mono text-[10px] text-muted">API URL</label>
                <input
                  type="text"
                  value={draft.apiUrl || "https://app.daytona.io/api"}
                  onChange={(event) => onDraft({ ...draft, apiUrl: event.target.value })}
                  className="gc-field w-full font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] text-muted">API key</label>
                <input
                  type="password"
                  value={draft.apiKey || ""}
                  onChange={(event) => onDraft({ ...draft, apiKey: event.target.value })}
                  placeholder={connector.configured ? "Leave blank to keep current key" : "dtn_..."}
                  className="gc-field w-full font-mono"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
