"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Copy, ExternalLink, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

type AgentGrant = {
  id: number;
  client: { id: string; name: string; source: string };
  scopes: string[];
  deployments: Array<{ id: number; name: string; slug: string }>;
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
};

type AgentAccess = {
  mcpUrl: string;
  oauthIssuer: string;
  grants: AgentGrant[];
};

export default function AgentsPage() {
  const [data, setData] = useState<AgentAccess | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busyGrant, setBusyGrant] = useState<number | null>(null);

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load agent access");
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => { void load(); }, []);

  async function copyEndpoint() {
    if (!data?.mcpUrl) return;
    await navigator.clipboard.writeText(data.mcpUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function revoke(grantId: number) {
    setBusyGrant(grantId);
    try {
      const response = await fetch("/api/agents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not revoke access");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyGrant(null);
    }
  }

  return (
    <div className="gc-page gc-page--wide">
      <PageHeader
        eyebrow="Agent access"
        title="Connect your agents"
        description="Give ChatGPT, Convoy, or any compatible MCP client scoped infrastructure capabilities without exposing SSH keys, provider credentials, or an unrestricted shell."
      />

      {error && <div className="mb-5 border border-error/30 bg-error/5 p-3 text-sm text-error">{error}</div>}

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="gc-eyebrow">MCP endpoint</p>
              <h2 className="mt-2 text-lg font-semibold">One endpoint, OAuth on demand</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                Paste this endpoint into a remote MCP client. GroundControl advertises OAuth automatically, then asks you which capabilities and deployments to grant.
              </p>
            </div>
            <ShieldCheck className="h-5 w-5 text-success" aria-hidden="true" />
          </div>
          <div className="mt-5 flex min-w-0 items-center gap-2 border border-border bg-background p-2">
            <code className="min-w-0 flex-1 truncate px-2 font-mono text-xs text-foreground">{data?.mcpUrl || "Loading…"}</code>
            <button type="button" onClick={() => void copyEndpoint()} disabled={!data} className="gc-button gc-button-secondary">
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Step number="1" title="Add MCP URL" detail="Create a custom app/connector in your agent and paste the endpoint." />
            <Step number="2" title="Sign in" detail="GroundControl opens its OAuth consent screen. No infrastructure secret leaves GC." />
            <Step number="3" title="Choose autonomy" detail="Grant only the deployments and actions the agent should be able to use." />
          </div>
        </div>

        <div className="border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center border border-border bg-background"><Bot size={17} /></span>
            <div>
              <p className="gc-eyebrow">ChatGPT web</p>
              <h2 className="mt-1 text-base font-semibold">Custom MCP app</h2>
            </div>
          </div>
          <ol className="mt-5 space-y-3 text-xs leading-relaxed text-muted">
            <li><span className="mr-2 font-mono text-accent">01</span>Open ChatGPT Settings → Apps and create a custom MCP app.</li>
            <li><span className="mr-2 font-mono text-accent">02</span>Paste the GroundControl MCP endpoint and scan tools.</li>
            <li><span className="mr-2 font-mono text-accent">03</span>Complete GroundControl sign-in and workload consent when prompted.</li>
          </ol>
          <a href="https://chatgpt.com/" target="_blank" rel="noreferrer" className="gc-button gc-button-secondary mt-5">
            Open ChatGPT <ExternalLink size={13} />
          </a>
        </div>
      </section>

      <section className="mt-6 border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="gc-eyebrow">Authorized clients</p>
            <h2 className="mt-1 text-base font-medium">Who can operate this control plane</h2>
          </div>
          <button type="button" onClick={() => void load()} className="gc-icon-button" title="Refresh"><RefreshCw size={14} /></button>
        </div>

        {!data ? (
          <p className="px-5 py-8 text-sm text-muted">Loading agent grants…</p>
        ) : data.grants.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Bot className="mx-auto h-6 w-6 text-muted" />
            <p className="mt-3 text-sm">No external agents are connected yet.</p>
            <p className="mt-1 text-xs text-muted">Your first client will appear here after OAuth consent.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.grants.map((grant) => (
              <div key={grant.id} className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{grant.client.name}</h3>
                      <span className={`rounded px-2 py-0.5 font-mono text-[9px] ${grant.revoked ? "bg-error/10 text-error" : "bg-success/10 text-success"}`}>
                        {grant.revoked ? "revoked" : "active"}
                      </span>
                      <span className="font-mono text-[9px] text-muted">{grant.client.source}</span>
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-muted">{grant.scopes.join(" · ")}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {grant.deployments.map((deployment) => (
                        <span key={deployment.id} className="border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted">{deployment.slug}</span>
                      ))}
                    </div>
                  </div>
                  {!grant.revoked && (
                    <button
                      type="button"
                      disabled={busyGrant === grant.id}
                      onClick={() => void revoke(grant.id)}
                      className="gc-button gc-button-quiet text-error"
                    >
                      <Unplug size={13} />{busyGrant === grant.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Step({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <div className="border border-border bg-background p-3">
      <p className="font-mono text-[9px] text-accent">{number}</p>
      <p className="mt-2 text-xs font-medium">{title}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted">{detail}</p>
    </div>
  );
}
