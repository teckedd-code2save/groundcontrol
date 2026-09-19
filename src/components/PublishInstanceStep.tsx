"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Cloud,
  Copy,
  Globe2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

type VerificationStatus = "ready" | "failed" | "skipped";

type Verification = {
  ok: boolean;
  publicUrl: string | null;
  checkedAt: string;
  checks: Record<string, {
    status: VerificationStatus;
    detail: string;
  }>;
};

type PublishStatus = {
  mode: "private" | "caddy" | "cloudflare" | "quick_tunnel";
  publicUrl: string | null;
  claimed: boolean;
  cloudflareConfigured: boolean;
  cloudflareAccountId?: string | null;
  lastVerification?: Verification | null;
};

type PublishMethod = "caddy" | "cloudflare" | "quick_tunnel" | "private";

export default function PublishInstanceStep({
  onComplete,
  onBack,
}: {
  onComplete: () => void;
  onBack?: () => void;
}) {
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [method, setMethod] = useState<PublishMethod>("caddy");
  const [hostname, setHostname] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [requiredRecord, setRequiredRecord] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/instance/publish", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load publish status");
      setStatus(data);
      setVerification(data.lastVerification || null);
      if (data.publicUrl) {
        try {
          const parsed = new URL(data.publicUrl);
          setHostname(parsed.hostname);
        } catch {}
      }
      if (data.mode && data.mode !== "private") setMethod(data.mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load publish status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function publish() {
    setWorking(true);
    setError("");
    setRequiredRecord(null);
    try {
      const payload: Record<string, unknown> = { action: method };
      if (method === "caddy" || method === "cloudflare") {
        payload.hostname = hostname.trim();
      }
      if (method === "cloudflare" && !status?.cloudflareConfigured) {
        payload.apiToken = apiToken.trim();
        if (accountId.trim()) payload.accountId = accountId.trim();
      }

      const response = await fetch("/api/instance/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === "DNS_REQUIRED" && data.requiredRecord) {
          setRequiredRecord(data.requiredRecord);
        }
        throw new Error(data.error || "Could not publish GroundControl");
      }

      setVerification(data.verification || null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish GroundControl");
    } finally {
      setWorking(false);
    }
  }

  async function verifyAgain() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/instance/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verification failed");
      setVerification(data.verification || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed");
    } finally {
      setWorking(false);
    }
  }

  async function copyUrl() {
    if (!status?.publicUrl) return;
    await navigator.clipboard.writeText(status.publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (loading) {
    return (
      <div className="mt-6 border border-border bg-card p-5">
        <p className="font-mono text-xs text-muted">Checking how this GroundControl instance is published…</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <MethodCard
          active={method === "caddy"}
          icon={<Globe2 className="h-4 w-4" />}
          title="I have a domain"
          detail="Point DNS here and let GroundControl configure Caddy + HTTPS."
          onClick={() => setMethod("caddy")}
        />
        <MethodCard
          active={method === "cloudflare"}
          icon={<Cloud className="h-4 w-4" />}
          title="Use Cloudflare Tunnel"
          detail="Private origin, managed DNS and HTTPS without opening the GC port."
          onClick={() => setMethod("cloudflare")}
        />
        <MethodCard
          active={method === "quick_tunnel"}
          icon={<ShieldCheck className="h-4 w-4" />}
          title="No domain yet"
          detail="Create a temporary outbound HTTPS URL to finish setup."
          onClick={() => setMethod("quick_tunnel")}
        />
        <MethodCard
          active={method === "private"}
          icon={<LockKeyhole className="h-4 w-4" />}
          title="Keep it private"
          detail="Use local/SSH access only. External MCP clients will not be able to reach it yet."
          onClick={() => setMethod("private")}
        />
      </div>

      {(method === "caddy" || method === "cloudflare") && (
        <div className="border border-border bg-card p-5">
          <label className="gc-label" htmlFor="gc-publish-hostname">GroundControl hostname</label>
          <input
            id="gc-publish-hostname"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="gc.example.com"
            className="gc-field mt-2 w-full font-mono"
          />
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            This hostname becomes the operator login, OAuth issuer and MCP base URL for this instance.
          </p>

          {method === "cloudflare" && !status?.cloudflareConfigured && (
            <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2">
              <div>
                <label className="gc-label" htmlFor="gc-cf-token">Cloudflare API token</label>
                <input
                  id="gc-cf-token"
                  type="password"
                  value={apiToken}
                  onChange={(event) => setApiToken(event.target.value)}
                  placeholder="Token with Tunnel + DNS access"
                  className="gc-field mt-2 w-full font-mono"
                />
              </div>
              <div>
                <label className="gc-label" htmlFor="gc-cf-account">Account ID (optional)</label>
                <input
                  id="gc-cf-account"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  placeholder="Auto-detected when token sees one account"
                  className="gc-field mt-2 w-full font-mono"
                />
              </div>
              <p className="md:col-span-2 text-[10px] leading-relaxed text-muted">
                The token is stored encrypted on this GroundControl instance. If it exposes multiple accounts,
                provide the account ID explicitly.
              </p>
            </div>
          )}
        </div>
      )}

      {requiredRecord && (
        <div className="border border-warning/30 bg-warning/5 p-4">
          <p className="text-xs font-medium text-warning">One DNS record is needed before HTTPS can be issued.</p>
          <div className="mt-3 grid grid-cols-[70px_1fr] gap-x-3 gap-y-1 font-mono text-[10px]">
            <span className="text-muted">Type</span><span>{requiredRecord.type}</span>
            <span className="text-muted">Name</span><span className="break-all">{requiredRecord.name}</span>
            <span className="text-muted">Value</span><span className="break-all">{requiredRecord.content}</span>
          </div>
          <p className="mt-3 text-[10px] text-muted">After DNS resolves, press Publish again. GroundControl will configure Caddy and verify HTTPS.</p>
        </div>
      )}

      {error && (
        <div className="border border-error/30 bg-error/5 p-3 text-xs text-error">{error}</div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {onBack && (
          <button type="button" onClick={onBack} disabled={working} className="gc-button gc-button-quiet">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={() => void publish()}
          disabled={
            working ||
            ((method === "caddy" || method === "cloudflare") && !hostname.trim()) ||
            (method === "cloudflare" && !status?.cloudflareConfigured && !apiToken.trim())
          }
          className="gc-button gc-button-primary flex-1"
        >
          {working
            ? "Publishing & verifying…"
            : method === "private"
              ? "Keep private & verify"
              : method === "quick_tunnel"
                ? "Create temporary HTTPS"
                : "Publish & verify"}
        </button>
      </div>

      {status?.publicUrl && (
        <div className="border border-success/25 bg-success/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-success">Management URL</p>
              <a href={status.publicUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-xs hover:text-accent">
                {status.publicUrl}
              </a>
            </div>
            <button type="button" onClick={() => void copyUrl()} className="gc-button gc-button-quiet text-[10px]">
              <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {status.mode === "quick_tunnel" && (
            <p className="mt-2 text-[10px] text-warning">
              Temporary bridge. Its hostname may change when the connector restarts. Attach a domain for a durable instance URL.
            </p>
          )}
        </div>
      )}

      {verification && (
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className={`h-4 w-4 ${verification.ok ? "text-success" : "text-warning"}`} />
              <p className="text-xs font-medium">
                {verification.ok ? "GroundControl is ready" : "Verification needs attention"}
              </p>
            </div>
            <button type="button" onClick={() => void verifyAgain()} disabled={working} className="gc-button gc-button-quiet text-[10px]">
              <RefreshCw className={`h-3 w-3 ${working ? "animate-spin" : ""}`} /> Verify again
            </button>
          </div>
          <div className="grid sm:grid-cols-2">
            {Object.entries(verification.checks).map(([name, item]) => (
              <div key={name} className="border-b border-border px-4 py-3 sm:border-r">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[9px] text-muted">{labelFor(name)}</span>
                  <span className={`font-mono text-[8px] ${
                    item.status === "ready"
                      ? "text-success"
                      : item.status === "skipped"
                        ? "text-muted"
                        : "text-error"
                  }`}>
                    {item.status}
                  </span>
                </div>
                {item.status !== "ready" && (
                  <p className="mt-1.5 text-[9px] leading-relaxed text-muted">{item.detail}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onComplete}
        disabled={!verification?.ok}
        className="w-full rounded-md border border-accent/30 bg-accent/10 py-3 text-sm font-mono text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Continue to server scan →
      </button>
    </div>
  );
}

function MethodCard({
  active,
  icon,
  title,
  detail,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border p-4 text-left transition-colors ${
        active
          ? "border-accent bg-accent/10"
          : "border-border bg-card hover:border-accent/40"
      }`}
    >
      <span className={active ? "text-accent" : "text-muted"}>{icon}</span>
      <span className="mt-3 block text-sm font-medium">{title}</span>
      <span className="mt-1 block text-[10px] leading-relaxed text-muted">{detail}</span>
    </button>
  );
}

function labelFor(value: string) {
  return ({
    container: "Container",
    storage: "Persistent storage",
    hostExecution: "Host execution",
    terminalPty: "Terminal PTY",
    mcpDiscovery: "MCP discovery",
    oauthMetadata: "OAuth metadata",
    claimBoundary: "Claim boundary",
    publicHttps: "Public HTTPS",
  } as Record<string, string>)[value] || value;
}
