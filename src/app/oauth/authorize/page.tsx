"use client";

import { useEffect, useMemo, useState } from "react";

type ConsentContext = {
  client: { id: string; name: string; source: string };
  scopes: Array<{ id: string; label: string; write: boolean }>;
  deployments: Array<{ id: number; name: string; slug: string; kind: string; status: string; vpsConfig?: { name: string } | null }>;
  selectedDeploymentIds: number[];
  user: { username: string; role: string };
};

export default function OAuthAuthorizePage() {
  const [context, setContext] = useState<ConsentContext | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useMemo(() => typeof window === "undefined" ? "" : window.location.search.slice(1), []);

  useEffect(() => {
    const url = `/api/oauth/authorize/context?${query}`;
    fetch(url, { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) {
        const next = `/oauth/authorize?${query}`;
        window.location.assign(`/login?next=${encodeURIComponent(next)}`);
        return null;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || data.error || "Could not prepare authorization");
      return data as ConsentContext;
    }).then((data) => {
      if (!data) return;
      setContext(data);
      setSelected(new Set(data.selectedDeploymentIds));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [query]);

  async function decide(approved: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/oauth/authorize/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          approved,
          deploymentIds: [...selected],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || data.error || "Authorization failed");
      window.location.assign(data.redirectTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  if (!context && !error) {
    return <main className="min-h-screen bg-bg-darker p-6 text-foreground"><div className="mx-auto mt-24 max-w-xl font-mono text-sm text-muted">Preparing GroundControl authorization…</div></main>;
  }

  return (
    <main className="min-h-screen bg-bg-darker px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto max-w-2xl border border-border bg-card shadow-[0_30px_90px_rgba(0,0,0,0.28)]">
        <header className="border-b border-border p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">GroundControl agent access</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {context ? `Connect ${context.client.name}` : "Authorization could not start"}
          </h1>
          {context && <p className="mt-2 text-sm text-muted">Signed in as {context.user.username}. Choose exactly which workloads this agent may operate.</p>}
        </header>

        {error && <div className="m-6 border border-error/30 bg-error/5 p-3 text-sm text-error">{error}</div>}

        {context && (
          <div className="space-y-6 p-6">
            <section>
              <h2 className="text-sm font-medium">Requested capabilities</h2>
              <div className="mt-3 divide-y divide-border border border-border">
                {context.scopes.map((scope) => (
                  <div key={scope.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div>
                      <p className="font-mono text-xs">{scope.id}</p>
                      <p className="mt-1 text-xs text-muted">{scope.label}</p>
                    </div>
                    <span className={`rounded px-2 py-0.5 font-mono text-[9px] ${scope.write ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                      {scope.write ? "write" : "read"}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">Allowed deployments</h2>
                  <p className="mt-1 text-xs text-muted">Unselected workloads remain invisible to this client.</p>
                </div>
                <button type="button" className="text-xs text-accent" onClick={() => {
                  setSelected(selected.size === context.deployments.length ? new Set() : new Set(context.deployments.map((item) => item.id)));
                }}>
                  {selected.size === context.deployments.length ? "Clear" : "Select all"}
                </button>
              </div>
              <div className="mt-3 max-h-72 divide-y divide-border overflow-auto border border-border">
                {context.deployments.map((deployment) => {
                  const checked = selected.has(deployment.id);
                  return (
                    <label key={deployment.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-background/50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(deployment.id)) next.delete(deployment.id); else next.add(deployment.id);
                          return next;
                        })}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{deployment.name}</span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted">
                          {deployment.slug} · {deployment.vpsConfig?.name || "host"} · {deployment.status}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
              <button disabled={busy} type="button" onClick={() => void decide(false)} className="gc-button gc-button-quiet">Deny</button>
              <button disabled={busy || selected.size === 0} type="button" onClick={() => void decide(true)} className="gc-button gc-button-primary">
                {busy ? "Authorizing…" : `Authorize ${selected.size} deployment${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
