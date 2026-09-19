"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  FolderGit2,
  GitBranch,
  Link2,
  PackageCheck,
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
  status: "not_configured" | "app_ready" | "installed";
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
    sourceRepairWrite: boolean;
  };
  installations: Installation[];
};

type RegistryState = {
  status: "not_configured" | "ready" | "error";
  configured: boolean;
  username: string;
  verifiedImage: string;
  lastCheckedAt: string;
  error: string;
};

const EMPTY_REGISTRY: RegistryState = {
  status: "not_configured",
  configured: false,
  username: "",
  verifiedImage: "",
  lastCheckedAt: "",
  error: "",
};

const EMPTY_STATE: GithubAppState = {
  status: "not_configured",
  publicUrl: "",
  requirements: {
    publicHttps: false,
    appCreated: false,
    installationConnected: false,
    webhookReachable: false,
    sourceRepairWrite: false,
  },
  installations: [],
};

export default function GithubAppPanel() {
  const [state, setState] = useState<GithubAppState>(EMPTY_STATE);
  const [registry, setRegistry] = useState<RegistryState>(EMPTY_REGISTRY);
  const [publicUrl, setPublicUrl] = useState("");
  const [registryOpen, setRegistryOpen] = useState(false);
  const [registryDraft, setRegistryDraft] = useState({ username: "", token: "" });
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<"create" | "sync" | "registry" | "disconnect" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, registryResponse] = await Promise.all([
        fetch("/api/github/app"),
        fetch("/api/github/registry"),
      ]);
      const [data, registryData] = await Promise.all([response.json(), registryResponse.json()]);
      if (!response.ok) throw new Error(data.error || "Could not load GitHub");
      if (!registryResponse.ok) throw new Error(registryData.error || "Could not load GHCR status");

      setState(data);
      setRegistry(registryData);
      setPublicUrl(data.publicUrl || (window.location.protocol === "https:" ? window.location.origin : ""));
      setRegistryDraft({
        username: registryData.username || data.app?.ownerLogin || "",
        token: "",
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load GitHub" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "app-created") {
      setMessage({
        tone: "success",
        text: "GitHub is connected. Choose Connect Repo to grant repository access.",
      });
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
      if (!response.ok) throw new Error(data.error || "Could not start GitHub setup");

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
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not start GitHub setup" });
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
      setMessage({ tone: "success", text: "GitHub repository access refreshed." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Repository sync failed" });
    } finally {
      setOperation(null);
    }
  }

  async function saveRegistry() {
    setOperation("registry");
    setMessage(null);
    try {
      const response = await fetch("/api/github/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registryDraft),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || data.state?.error || "Private GHCR access could not be verified");
      }
      setRegistry(data.state);
      setRegistryDraft((current) => ({ ...current, token: "" }));
      setRegistryOpen(false);
      setMessage({ tone: "success", text: data.message || "Private GHCR pulls are ready." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Private GHCR access could not be verified" });
      await load();
    } finally {
      setOperation(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect GitHub, repository links and private GHCR access from this GroundControl instance?")) return;
    setOperation("disconnect");
    try {
      const response = await fetch("/api/github/app", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Disconnect failed");
      await load();
      setMessage({ tone: "success", text: data.note || "GitHub disconnected locally." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Disconnect failed" });
    } finally {
      setOperation(null);
    }
  }

  const statusLabel = state.status === "installed"
    ? "GitHub connected"
    : state.status === "app_ready"
      ? "Connect a repo"
      : "Not connected";

  return (
    <section className="overflow-hidden border border-border bg-card">
      <div className="flex flex-col gap-4 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted">
            <FolderGit2 className="h-4.5 w-4.5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">GitHub</h2>
              <span className="rounded-sm bg-muted/10 px-2 py-0.5 font-mono text-[9px] text-muted">
                {loading ? "checking" : statusLabel}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Connect GitHub once, then choose the repositories GroundControl may operate.
            </p>
          </div>
        </div>

        {state.app && (
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://github.com/apps/${state.app.slug}/installations/new`}
              target="_blank"
              rel="noreferrer"
              className="gc-button gc-button-primary text-[10px]"
            >
              Connect Repo <ExternalLink className="h-3 w-3" />
            </a>
            <button type="button" onClick={syncRepositories} disabled={operation !== null} className="gc-button gc-button-secondary text-[10px]">
              <RefreshCw className={`h-3 w-3 ${operation === "sync" ? "animate-spin" : ""}`} />
              Sync
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
        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <label className="gc-label" htmlFor="github-public-url">This GroundControl URL</label>
            <input
              id="github-public-url"
              value={publicUrl}
              onChange={(event) => setPublicUrl(event.target.value)}
              placeholder="https://gc.example.com"
              className="gc-field mt-2 w-full font-mono"
            />
            <p className="mt-2 text-[10px] leading-relaxed text-muted">
              GitHub uses this HTTPS URL for the App callback and signed webhooks.
            </p>
          </div>
          <button
            type="button"
            onClick={createApp}
            disabled={operation !== null || !publicUrl.trim()}
            className="gc-button gc-button-primary"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {operation === "create" ? "Opening GitHub…" : "Connect GitHub"}
          </button>
        </div>
      ) : (
        <>
          <div className="grid border-b border-border sm:grid-cols-4">
            <CompactStat label="Repos" value={repositoryCount} />
            <CompactStat label="Connected" value={linkedCount} />
            <CompactState
              icon={<Webhook className="h-3 w-3" />}
              label="Webhooks"
              value={state.requirements.webhookReachable ? "verified" : "pending"}
              good={state.requirements.webhookReachable}
            />
            <CompactState
              icon={<GitBranch className="h-3 w-3" />}
              label="Repair PRs"
              value={state.requirements.sourceRepairWrite ? "ready" : "permission needed"}
              good={state.requirements.sourceRepairWrite}
            />
          </div>

          {state.installations.length === 0 ? (
            <div className="p-5">
              <p className="text-sm font-medium">GitHub is connected. No repositories are granted yet.</p>
              <p className="mt-1 text-xs text-muted">
                Choose <strong className="font-medium text-foreground">Connect Repo</strong>, select your GitHub account and grant only the repositories GroundControl should see.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {state.installations.map((installation) => (
                <div key={installation.id}>
                  <div className="flex items-center justify-between gap-3 bg-background/40 px-5 py-2.5">
                    <p className="text-xs font-medium">{installation.accountLogin}</p>
                    <p className="font-mono text-[9px] text-muted">{installation.repositories.length} repo{installation.repositories.length === 1 ? "" : "s"}</p>
                  </div>
                  <div className="divide-y divide-border">
                    {installation.repositories.map((repository) => (
                      <div key={repository.id} className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <a
                            href={repository.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-full items-center gap-1.5 truncate text-xs font-medium hover:text-accent"
                          >
                            {repository.fullName} <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <p className="mt-1 font-mono text-[9px] text-muted">
                            {repository.defaultBranch} · {repository.private ? "private" : "public"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {repository.deployments.length > 0 ? (
                            repository.deployments.map((deployment) => (
                              <Link
                                key={deployment.id}
                                href={`/deployments/${deployment.slug}?tab=source`}
                                className="inline-flex items-center gap-1 rounded-sm border border-success/25 bg-success/5 px-2 py-1 font-mono text-[9px] text-success"
                              >
                                <Link2 className="h-3 w-3" /> {deployment.name}
                              </Link>
                            ))
                          ) : (
                            <Link
                              href="/deployments"
                              className="rounded-sm border border-border px-2 py-1 font-mono text-[9px] text-muted hover:border-accent/40 hover:text-foreground"
                            >
                              Connect Repo
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-border bg-background/30 px-5 py-4">
            <button
              type="button"
              onClick={() => setRegistryOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="flex items-center gap-2">
                <PackageCheck className="h-3.5 w-3.5 text-muted" />
                <span>
                  <span className="block text-[11px] font-medium">Private GHCR pulls</span>
                  <span className="mt-0.5 block text-[10px] text-muted">
                    {registry.status === "ready"
                      ? `Verified as ${registry.username}`
                      : "Optional. Public images need no credential."}
                  </span>
                </span>
              </span>
              <span className={`font-mono text-[9px] ${registry.status === "ready" ? "text-success" : registry.status === "error" ? "text-error" : "text-muted"}`}>
                {registry.status === "ready" ? "ready" : registry.status === "error" ? "attention" : registryOpen ? "close" : "configure"}
              </span>
            </button>

            {registryOpen && (
              <div className="mt-4 grid gap-3 border-t border-border pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <p className="text-[10px] leading-relaxed text-muted">
                    GitHub Packages currently requires a classic personal access token for direct registry authentication.
                    GroundControl only needs <code className="text-foreground">read:packages</code> for private pulls and stores the token encrypted.
                  </p>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=read:packages&description=GroundControl%20private%20image%20pulls"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                  >
                    Create read-only package token <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
                <div className="space-y-2">
                  <input
                    value={registryDraft.username}
                    onChange={(event) => setRegistryDraft((current) => ({ ...current, username: event.target.value }))}
                    placeholder="GitHub username"
                    autoComplete="username"
                    className="gc-field w-full font-mono"
                  />
                  <input
                    type="password"
                    value={registryDraft.token}
                    onChange={(event) => setRegistryDraft((current) => ({ ...current, token: event.target.value }))}
                    placeholder={registry.configured ? "Paste a replacement token" : "Paste read:packages token"}
                    autoComplete="new-password"
                    className="gc-field w-full font-mono"
                  />
                  <button
                    type="button"
                    onClick={saveRegistry}
                    disabled={operation !== null || !registryDraft.username.trim() || !registryDraft.token.trim()}
                    className="gc-button gc-button-primary text-[10px]"
                  >
                    {operation === "registry" ? "Verifying…" : registry.configured ? "Update & verify" : "Enable & verify"}
                  </button>
                  {registry.error && <p className="text-[10px] leading-relaxed text-error">{registry.error}</p>}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function CompactStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-border px-5 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function CompactState({
  icon,
  label,
  value,
  good,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <div className="border-b border-border px-5 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
        {icon}{label}
      </p>
      <p className={`mt-1 text-[11px] ${good ? "text-success" : "text-warning"}`}>{value}</p>
    </div>
  );
}
