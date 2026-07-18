"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Link2,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Webhook,
} from "lucide-react";

type Repository = {
  id: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  deployments: Array<{ id: number; name: string; slug: string }>;
};

type Installation = {
  id: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  suspended: boolean;
  lastSyncedAt?: string | null;
  repositories: Repository[];
};

type GithubAppState = {
  status: "not_configured" | "app_ready" | "connected";
  publicUrl: string;
  webhookUrl?: string;
  lastWebhook?: { event: string; processedAt: string | null } | null;
  app?: {
    id: string;
    slug: string;
    name: string;
    ownerLogin: string;
    permissions: Record<string, string>;
    events: string[];
    updatedAt: string;
  };
  requirements: {
    publicHttps: boolean;
    appCreated: boolean;
    installationConnected: boolean;
    webhookReachable: boolean;
  };
  installations: Installation[];
};

const EMPTY_STATE: GithubAppState = {
  status: "not_configured",
  publicUrl: "",
  requirements: {
    publicHttps: false,
    appCreated: false,
    installationConnected: false,
    webhookReachable: false,
  },
  installations: [],
};

export default function GithubAppPanel() {
  const [state, setState] = useState<GithubAppState>(EMPTY_STATE);
  const [publicUrl, setPublicUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<"create" | "sync" | "disconnect" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/github/app");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load GitHub App status");
      setState(data);
      setPublicUrl(data.publicUrl || (window.location.protocol === "https:" ? window.location.origin : ""));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load GitHub App status" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "app-created") {
      setMessage({ tone: "success", text: "GitHub App created. Install it on the repositories GroundControl should observe." });
    }
    const callbackError = params.get("github_error");
    if (callbackError) setMessage({ tone: "error", text: callbackError });
  }, [load]);

  const repositoryCount = useMemo(
    () => state.installations.reduce((total, installation) => total + installation.repositories.length, 0),
    [state.installations]
  );
  const linkedCount = useMemo(
    () => state.installations.reduce(
      (total, installation) => total + installation.repositories.filter((repository) => repository.deployments.length > 0).length,
      0
    ),
    [state.installations]
  );

  async function createApp() {
    setOperation("create");
    setMessage(null);
    try {
      const response = await fetch("/api/github/app/manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start GitHub App setup");
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.action;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "manifest";
      input.value = data.manifest;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not start GitHub App setup" });
      setOperation(null);
    }
  }

  async function syncRepositories() {
    setOperation("sync");
    setMessage(null);
    try {
      const response = await fetch("/api/github/app/sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Repository sync failed");
      await load();
      setMessage({ tone: "success", text: "Repository access and deployment links reconciled." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Repository sync failed" });
    } finally {
      setOperation(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Remove the GitHub App credentials and repository links from this GroundControl instance?")) return;
    setOperation("disconnect");
    try {
      const response = await fetch("/api/github/app", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Disconnect failed");
      await load();
      setMessage({ tone: "success", text: data.note || "GitHub App disconnected locally." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Disconnect failed" });
    } finally {
      setOperation(null);
    }
  }

  const statusLabel = state.status === "connected" ? "connected" : state.status === "app_ready" ? "installation required" : "not configured";

  return (
    <section className="overflow-hidden border border-border bg-card">
      <div className="flex flex-col gap-4 border-b border-border px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border ${state.status === "connected" ? "border-success/30 bg-success/10 text-success" : "border-border bg-background text-muted"}`}>
            <FolderGit2 className="h-4.5 w-4.5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">GitHub App</h2>
              <span className={`rounded-sm px-2 py-0.5 font-mono text-[9px] ${state.status === "connected" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                {loading ? "checking" : statusLabel}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              Repository-scoped access, signed change events and short-lived credentials for deployment intelligence. GroundControl never asks for a personal access token here.
            </p>
          </div>
        </div>
        {state.app && (
          <div className="flex flex-wrap gap-2">
            <a href={`https://github.com/apps/${state.app.slug}/installations/new`} target="_blank" rel="noreferrer" className="gc-button gc-button-primary text-[10px]">
              Install on repositories <ExternalLink className="h-3 w-3" />
            </a>
            <button type="button" onClick={syncRepositories} disabled={operation !== null} className="gc-button gc-button-secondary text-[10px]">
              <RefreshCw className={`h-3 w-3 ${operation === "sync" ? "animate-spin" : ""}`} /> Sync
            </button>
            <button type="button" onClick={disconnect} disabled={operation !== null} className="gc-button gc-button-quiet text-[10px] text-error">
              <Unplug className="h-3 w-3" /> Disconnect
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className={`border-b px-5 py-3 text-xs ${message.tone === "success" ? "border-success/20 bg-success/5 text-success" : "border-error/20 bg-error/5 text-error"}`}>
          {message.text}
        </div>
      )}

      {!state.app ? (
        <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <label className="gc-label" htmlFor="github-public-url">GroundControl public URL</label>
            <input
              id="github-public-url"
              value={publicUrl}
              onChange={(event) => setPublicUrl(event.target.value)}
              placeholder="https://groundcontrol.example.com"
              className="gc-field mt-2 w-full max-w-xl font-mono"
            />
            <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-muted">
              GitHub must reach this HTTPS address for signed webhooks. If GroundControl is private, expose only the webhook endpoint through your Cloudflare Tunnel before continuing.
            </p>
            <button type="button" onClick={createApp} disabled={operation !== null || !publicUrl.trim()} className="gc-button gc-button-primary mt-4">
              <ShieldCheck className="h-3.5 w-3.5" /> {operation === "create" ? "Opening GitHub…" : "Create operator-owned GitHub App"}
            </button>
          </div>
          <Readiness requirements={state.requirements} />
        </div>
      ) : (
        <>
          <div className="grid border-b border-border sm:grid-cols-3">
            <Metric label="Installations" value={state.installations.length} detail={state.app.name} />
            <Metric label="Repositories" value={repositoryCount} detail="Explicit GitHub access" />
            <Metric label="Linked workloads" value={linkedCount} detail="Matched by repository identity" accent />
          </div>
          <div className="grid gap-5 px-5 py-5 xl:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-4">
              <Readiness requirements={state.requirements} />
              <div className="border border-border bg-background p-3">
                <p className="gc-label">Webhook endpoint</p>
                <p className="mt-2 break-all font-mono text-[10px] text-muted">{state.webhookUrl}</p>
                <p className="mt-2 text-[10px] text-muted">Payloads are signature-verified and only sanitized event metadata is retained.</p>
                <p className="mt-2 font-mono text-[9px] text-muted">
                  {state.lastWebhook?.processedAt ? `Last verified: ${state.lastWebhook.event} · ${new Date(state.lastWebhook.processedAt).toLocaleString()}` : "No verified delivery received yet"}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {state.installations.length === 0 ? (
                <div className="border border-dashed border-border p-6">
                  <p className="text-sm font-medium">The App exists, but it is not installed.</p>
                  <p className="mt-1 text-xs text-muted">Choose “Install on repositories,” select an account and grant access only to the repositories GroundControl should manage.</p>
                </div>
              ) : state.installations.map((installation) => (
                <div key={installation.id} className="border border-border bg-background">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div>
                      <p className="text-xs font-medium">{installation.accountLogin}</p>
                      <p className="mt-0.5 font-mono text-[9px] text-muted">{installation.repositorySelection} repositories · installation {installation.id}</p>
                    </div>
                    <span className={`rounded-sm px-2 py-1 font-mono text-[9px] ${installation.suspended ? "bg-error/10 text-error" : "bg-success/10 text-success"}`}>
                      {installation.suspended ? "suspended" : "active"}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {installation.repositories.map((repository) => (
                      <div key={repository.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <a href={repository.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 truncate text-xs font-medium hover:text-accent">
                            {repository.fullName} <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] text-muted">
                            <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />{repository.defaultBranch}</span>
                            <span>{repository.private ? "private" : "public"}</span>
                            {repository.archived && <span>archived</span>}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {repository.deployments.length > 0 ? repository.deployments.map((deployment) => (
                            <a key={deployment.id} href={`/deployments/${deployment.slug}`} className="inline-flex items-center gap-1 rounded-sm border border-success/25 bg-success/5 px-2 py-1 font-mono text-[9px] text-success">
                              <Link2 className="h-3 w-3" /> {deployment.name}
                            </a>
                          )) : (
                            <Link href="/deployments" className="rounded-sm border border-border px-2 py-1 font-mono text-[9px] text-muted hover:border-accent/40 hover:text-foreground">
                              Set repository on deployment
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                    {installation.repositories.length === 0 && <p className="px-4 py-5 text-xs text-muted">No repository access has been reported yet. Install the App or sync after changing repository access.</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Readiness({ requirements }: { requirements: GithubAppState["requirements"] }) {
  const items = [
    ["Public HTTPS", requirements.publicHttps, Webhook],
    ["App credentials", requirements.appCreated, ShieldCheck],
    ["Repository installation", requirements.installationConnected, FolderGit2],
    ["Signed event path", requirements.webhookReachable, Check],
  ] as const;
  return (
    <div className="border border-border bg-background p-3">
      <p className="gc-label">Connection readiness</p>
      <div className="mt-3 space-y-2">
        {items.map(([label, ready, Icon]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="inline-flex items-center gap-2 text-muted"><Icon className="h-3.5 w-3.5" />{label}</span>
            <span className={ready ? "text-success" : "text-warning"}>{ready ? "ready" : "required"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, detail, accent = false }: { label: string; value: number; detail: string; accent?: boolean }) {
  return (
    <div className="border-b border-border px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="gc-label">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${accent ? "text-accent" : ""}`}>{value}</p>
      <p className="mt-1 text-[10px] text-muted">{detail}</p>
    </div>
  );
}
