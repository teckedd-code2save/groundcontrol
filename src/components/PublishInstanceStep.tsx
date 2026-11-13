"use client";

import { useEffect, useRef, useState } from "react";
import AddressFirewallHelp, { type AddressFirewallAssistance } from "./AddressFirewallHelp";
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
  localDesktop?: boolean;
  mode: "private" | "caddy" | "cloudflare" | "quick_tunnel";
  publicUrl: string | null;
  canonicalUrl?: string | null;
  retainedBootstrapUrl?: string | null;
  aliases?: string[];
  claimed: boolean;
  cloudflareConfigured: boolean;
  cloudflareAccountId?: string | null;
  lastVerification?: Verification | null;
};

type GeneratedAddress = {
  hostname: string;
  publicUrl: string;
  source: "provider" | "sslip";
  publicIpv4: string;
  stability: string;
  needs: { code: string; blocking: boolean; detail: string }[];
  canPublish: boolean;
  firewallAssistance?: AddressFirewallAssistance;
};

type PublishMethod = "caddy" | "cloudflare" | "quick_tunnel" | "private";

export default function PublishInstanceStep({
  onComplete,
  onBack,
}: {
  onComplete: () => void;
  onBack?: () => void;
}) {
  const started = useRef(false);
  const mutationInFlight = useRef(false);
  const previewRequest = useRef(0);
  const [generatedSetup, setGeneratedSetup] = useState(false);
  const [generated, setGenerated] = useState<GeneratedAddress | null>(null);
  const [generatedLoading, setGeneratedLoading] = useState(false);
  const [generatedError, setGeneratedError] = useState("");
  const [permanentSetup, setPermanentSetup] = useState(false);
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [method, setMethod] = useState<PublishMethod>("caddy");
  const [hostname, setHostname] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [requiredRecord, setRequiredRecord] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [workingLabel, setWorkingLabel] = useState("Verifying…");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function load(preserveSelection = false, checkTemporary = false) {
    setLoading(true);
    try {
      const response = await fetch("/api/instance/publish", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load publish status");
      setStatus(data);
      if (!preserveSelection && (data.localDesktop || data.mode === "private")) setMethod("private");
      setVerification(data.lastVerification?.publicUrl === data.publicUrl ? data.lastVerification : null);
      if (!preserveSelection && (data.mode === "quick_tunnel" || data.canonicalUrl)) setHostname("");
      if (!preserveSelection && data.publicUrl && data.mode !== "quick_tunnel" && !data.canonicalUrl) {
        try {
          const parsed = new URL(data.publicUrl);
          setHostname(parsed.hostname);
        } catch {}
      }
      if (!preserveSelection && data.mode && data.mode !== "private") setMethod(data.mode === "quick_tunnel" ? "caddy" : data.mode);
      if (checkTemporary && data.mode === "quick_tunnel" && data.publicUrl) {
        setVerification(null);
        setLoading(false);
        await verifyAgain(data.publicUrl);
      }
      return data as PublishStatus;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load publish status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load(false, true);
    // Initialize once per mount; editing the form must not recheck or reset inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasTemporaryAccess = status?.mode === "quick_tunnel" && Boolean(status.publicUrl);

  const showForm = !generatedSetup && (status?.localDesktop || permanentSetup || status?.mode === "private");
  const canonicalUrl = status?.canonicalUrl || null;
  const retainedBootstrapOrigin = publicHttpsOrigin(status?.retainedBootstrapUrl);
  const hasPermanentAccess = Boolean(status?.publicUrl && !hasTemporaryAccess);
  const generatedBlocked = !generated?.canPublish || generated.needs.some(need => need.blocking);

  function closeGenerated() {
    previewRequest.current += 1;
    setGeneratedSetup(false);
    setGeneratedLoading(false);
  }

  function openCustom() {
    closeGenerated();
    setMethod(current => current === "private" || current === "quick_tunnel" ? "caddy" : current);
    setPermanentSetup(true);
  }

  async function previewGenerated() {
    const request = ++previewRequest.current;
    setGeneratedSetup(true);
    setPermanentSetup(false);
    setGenerated(null);
    setGeneratedLoading(true);
    setGeneratedError("");
    try {
      const response = await fetch("/api/instance/publish?generatedAddress=1", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check the free server address.");
      if (!data.generatedAddress) throw new Error("No server address was returned. Retry the check or use your own domain.");
      if (request !== previewRequest.current) return;
      setGenerated(data.generatedAddress);
    } catch (cause) {
      if (request === previewRequest.current) setGeneratedError(cause instanceof Error ? cause.message : "Could not check the free server address.");
    } finally {
      if (request === previewRequest.current) setGeneratedLoading(false);
    }
  }
  const ready = Boolean(verification?.ok && verification.publicUrl === status?.publicUrl);

  async function publish(serverAddress = false) {
    if (mutationInFlight.current || (serverAddress && generatedBlocked)) return;
    if (!serverAddress && method === "quick_tunnel" && hasTemporaryAccess) {
      await verifyAgain(status?.publicUrl);
      return;
    }
    mutationInFlight.current = true;
    setVerification(null);
    setWorkingLabel(serverAddress ? "Setting up & verifying server address…" : method === "private" ? "Verifying private access…" : "Publishing & verifying…");
    setWorking(true);
    setError("");
    setRequiredRecord(null);
    try {
      const payload: Record<string, unknown> = { action: serverAddress ? "server_address" : method };
      if (!serverAddress && (method === "caddy" || method === "cloudflare")) {
        payload.hostname = hostname.trim();
      }
      if (!serverAddress && method === "cloudflare" && !status?.cloudflareConfigured) {
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

      if (serverAddress && !data.verification?.ok) throw new Error("Some server-address setup checks need attention. Your current access is shown below; review the checks before continuing.");
      setVerification(data.verification || null);
      const refreshed = await load();
      if (data.verification?.publicUrl === refreshed?.publicUrl) setVerification(data.verification);
      closeGenerated();
      setPermanentSetup(false);
    } catch (cause) {
      // A replacement may be live even when retiring an old path needs attention.
      // Reload authoritative status rather than leaving a stale handoff link visible.
      await load(true);
      setError(cause instanceof Error ? cause.message : "Could not publish GroundControl");
    } finally {
      mutationInFlight.current = false;
      setWorking(false);
    }
  }

  async function verifyAgain(expectedUrl = status?.publicUrl) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setVerification(null);
    setWorkingLabel("Verifying…");
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
      if (!data.verification || data.verification.publicUrl !== expectedUrl) {
        throw new Error("The access address changed during the check. Reload this page to check the current address.");
      }
      setVerification(data.verification);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed");
    } finally {
      mutationInFlight.current = false;
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
      {status?.localDesktop && (
        <div className="border border-border bg-card p-5 text-sm leading-relaxed text-muted">
          <p className="font-medium text-foreground">GroundControl is running on this computer</p>
          <p className="mt-2">Use your local login link while Docker is running. This workspace manages Docker workloads; it does not manage native Mac or Windows services. You can add a remote Linux server later in Connections.</p>
        </div>
      )}
      {!status?.localDesktop && !permanentSetup && !generatedSetup && (
        <div className="border border-border bg-card p-5">
          <h2 className="text-sm font-medium">{hasPermanentAccess ? "Your server address" : hasTemporaryAccess ? "Give this server its own address" : "Choose how to access this server"}</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">{canonicalUrl
            ? "Keep this primary address for your agents. You can add your own domain as another way to sign in."
            : hasPermanentAccess ? "Verify your current address, or configure your own domain."
            : "Use a free address for this server, without buying a domain or creating a Cloudflare account. You can connect your own domain later."}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {!hasPermanentAccess && <button type="button" disabled={working} onClick={() => void previewGenerated()} className="gc-button gc-button-primary">Set up free server address</button>}
            {hasPermanentAccess && <button type="button" disabled={working} onClick={() => void verifyAgain()} className="gc-button gc-button-primary">Verify existing access</button>}
            <button type="button" disabled={working} onClick={openCustom} className="gc-button gc-button-quiet">Use my own domain</button>
          </div>
        </div>
      )}

      {generatedSetup && (
        <div className="space-y-4 border border-border bg-card p-5">
          <div>
            <h2 className="text-sm font-medium">Free server address</h2>
            <p className="mt-2 text-xs text-muted">No changes are made until you choose Set up & verify address.</p>
          </div>
          {generatedLoading && <p role="status" className="text-xs text-muted">Checking this server’s address and requirements…</p>}
          {generatedError && <div role="alert" className="text-xs text-error">{generatedError}</div>}
          {generated && <>
            <div className="border-l-2 border-accent pl-3">
              <p className="font-mono text-xs break-all">{generated.publicUrl}</p>
              <p className="mt-1 text-xs text-muted">Proposed address · {generated.source === "provider" ? "Cloud provider hostname" : "Shared sslip.io DNS"} · not verified yet</p>
            </div>
            <p className="text-xs leading-relaxed text-muted">{generated.stability}</p>
            <p className="font-mono text-xs text-muted">Server IPv4: {generated.publicIpv4}</p>
            {generated.needs.filter(need => need.blocking || !["ports_unverified", "caddy_setup", "host_firewall_review", "provider_firewall_review"].includes(need.code)).map(need => <div key={need.code} className={`border-l-2 pl-3 text-xs leading-relaxed ${need.blocking ? "border-warning text-warning" : "border-border text-muted"}`}>
              {need.blocking && <p className="font-medium">Needs attention</p>}
              <p>{need.detail}</p>
            </div>)}
            <p className="text-xs leading-relaxed text-muted">Set up installs or configures Caddy and verifies HTTPS before switching access. Allow inbound TCP ports 80 and 443 in your cloud and server firewalls first. GroundControl does not open firewall ports for you.</p>
            <details className="text-xs leading-relaxed text-muted">
              <summary className="cursor-pointer">Detailed setup requirements</summary>
              {generated.needs.filter(need => !need.blocking && ["ports_unverified", "caddy_setup"].includes(need.code)).map(need => <p key={need.code} className="mt-2">{need.detail}</p>)}
            </details>
            <AddressFirewallHelp assistance={generated.firewallAssistance} hostname={generated.hostname} publicIpv4={generated.publicIpv4} />
            <button type="button" onClick={() => void publish(true)} disabled={working || generatedBlocked} className="gc-button gc-button-primary w-full">{working ? workingLabel : "Set up & verify address"}</button>
          </>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void previewGenerated()} disabled={working || generatedLoading} className="gc-button gc-button-quiet">{generatedError ? "Retry address check" : "Recheck network & requirements"}</button>
            <button type="button" onClick={openCustom} disabled={working} className="gc-button gc-button-quiet">Use my own domain</button>
            <button type="button" onClick={closeGenerated} disabled={working} className="gc-button gc-button-quiet">Back to current access</button>
          </div>
        </div>
      )}

      {showForm && <div className="space-y-3">
        {!status?.localDesktop && permanentSetup && <>
          <h2 className="text-sm font-medium">Connect your own domain</h2>
          <p className="text-xs text-muted">Optional. {canonicalUrl ? "Your primary address and agent connections stay unchanged." : "Use a domain you control."}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <MethodCard disabled={working} active={method === "caddy"} icon={<Globe2 className="h-4 w-4" />}
              title="Use my domain directly"
              detail="No Cloudflare account needed. Point your domain's DNS to this server; Caddy provides HTTPS. Requires inbound ports 80 and 443."
              onClick={() => setMethod("caddy")} />
            <MethodCard disabled={working} active={method === "cloudflare"} icon={<Cloud className="h-4 w-4" />}
              title="Connect through my Cloudflare account"
              detail="Optional alternative: requires a domain managed in your Cloudflare account and an API token. No inbound management ports needed."
              onClick={() => setMethod("cloudflare")} />
          </div>
        </>}
        {!status?.localDesktop && !hasTemporaryAccess && !canonicalUrl && !permanentSetup && <MethodCard disabled={working} active={method === "quick_tunnel"} icon={<ShieldCheck className="h-4 w-4" />}
          title="Temporary HTTPS for setup" detail="A temporary public link, not an ongoing server address."
          onClick={() => setMethod("quick_tunnel")} />}
        {!hasTemporaryAccess && !canonicalUrl && !permanentSetup && <MethodCard disabled={working} active={method === "private"} icon={<LockKeyhole className="h-4 w-4" />}
          title="Keep it private" detail="Use local/SSH access only. External MCP clients will not be able to reach it yet."
          onClick={() => setMethod("private")} />}
        {permanentSetup && <button type="button" disabled={working} onClick={() => setPermanentSetup(false)} className="gc-button gc-button-quiet">Back to current access</button>}
      </div>}

      {showForm && (method === "caddy" || method === "cloudflare") && (
        <div className="border border-border bg-card p-5">
          <label className="gc-label" htmlFor="gc-publish-hostname">GroundControl hostname</label>
          <input
            id="gc-publish-hostname"
            value={hostname}
            disabled={working}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="gc.example.com"
            className="gc-field mt-2 w-full font-mono"
          />
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            {canonicalUrl ? `This adds a sign-in address. Your primary address and OAuth/MCP identity stay at ${canonicalUrl}.` : "This hostname becomes the sign-in address and the OAuth/MCP base URL for this instance."}
          </p>

          <p className="mt-2 text-xs leading-relaxed text-muted">
            {method === "caddy"
              ? "Use a DNS-only A record pointing to this server's public IPv4 address. Ports 80 and 443 must be reachable through your cloud and host firewalls; GroundControl does not open them for you. IPv6-only or proxied DNS is not supported by this setup check."
              : "Use a domain in your Cloudflare account. The token needs zone read, DNS edit and account tunnel edit permissions. This outbound tunnel does not require opening inbound management ports."}
          </p>

          {method === "cloudflare" && !status?.cloudflareConfigured && (
            <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2">
              <div>
                <label className="gc-label" htmlFor="gc-cf-token">Cloudflare API token</label>
                <input
                  id="gc-cf-token"
                  type="password"
                  value={apiToken}
                  disabled={working}
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
                  disabled={working}
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

      {showForm && requiredRecord && (
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
        <div role="alert" className="border border-error/30 bg-error/5 p-3 text-xs text-error">{error}</div>
      )}

      {showForm && <div className="flex flex-col gap-2 sm:flex-row">
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
            ? workingLabel
            : method === "private"
              ? "Keep private & verify"
              : method === "quick_tunnel"
                ? "Create temporary HTTPS"
                : "Publish & verify"}
        </button>
      </div>}

      {status?.publicUrl && (
        <div className="border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">{canonicalUrl ? "Primary address" : "Current access"}</p>
              <a href={status.publicUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-xs hover:text-accent">
                {status.publicUrl}
              </a>
            </div>
            <button type="button" onClick={() => void copyUrl()} className="gc-button gc-button-quiet text-[10px]">
              <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {canonicalUrl && <p className="mt-3 text-xs text-muted">Agent connections and sign-in identity use this primary address.</p>}
          {canonicalUrl && status.retainedBootstrapUrl && (
            <div className="mt-3 space-y-2 border-l-2 border-warning pl-3 text-xs leading-relaxed">
              <p className="font-medium text-warning">Temporary public fallback retained</p>
              <p className="text-muted">The public setup link was kept to avoid disconnecting setup. Open and check your primary address, then have an operator inspect and remove the fallback. It is not private.</p>
              {retainedBootstrapOrigin && <a href={retainedBootstrapOrigin} target="_blank" rel="noreferrer" className="block break-all font-mono text-xs hover:text-accent">{retainedBootstrapOrigin}</a>}
              <p className="text-muted">Reconnect any agents that used the temporary address to your primary address.</p>
            </div>
          )}
          {Boolean(status.aliases?.length) && <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium">Additional sign-in addresses</p>
            {status.aliases?.map(alias => <a key={alias} href={alias} target="_blank" rel="noreferrer" className="mt-2 block break-all font-mono text-xs hover:text-accent">{alias}</a>)}
          </div>}
          {status.mode === "quick_tunnel" && (
            <div className="mt-3 space-y-2 text-xs leading-relaxed text-warning">
              <p>Temporary public address: it may stop after a server restart or change when recreated. Set up a free server address or your own domain for ongoing use.</p>
              <details>
                <summary className="cursor-pointer">Temporary access limitations</summary>
                <p className="mt-2">This is a public HTTPS sign-in link, not a private-only address. You can close the setup terminal; GroundControl and this tunnel run on the server.</p>
                <p className="mt-2">This temporary connector does not restart automatically after a server reboot. Recreating it gives you a new URL, so bookmarks and agent connections may need updating.</p>
                <p className="mt-2">Quick tunnels have no uptime guarantee and do not support server-sent event streams. Use a server address with HTTPS or a named Cloudflare Tunnel for ongoing access and agents.</p>
              </details>

            </div>
          )}
        </div>
      )}

      {hasTemporaryAccess && working && <p role="status" className="text-xs text-muted">{workingLabel === "Verifying…" ? "Checking existing access. This does not create or replace your tunnel." : workingLabel}</p>}
      {hasTemporaryAccess && error && !verification && <button type="button" disabled={working} onClick={() => void verifyAgain()} className="gc-button gc-button-quiet">Retry access check</button>}

      {verification && (
        <details open={!ready} className="border border-border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-xs">{ready ? "Access checks passed" : "Access checks need attention"}</summary>
        <div>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className={`h-4 w-4 ${verification.ok ? "text-success" : "text-warning"}`} />
              <p className="text-xs font-medium">
                {verification.ok ? "Access verified" : "Verification needs attention"}
              </p>
            </div>
            {(!hasPermanentAccess && (!hasTemporaryAccess || !ready)) && <button type="button" onClick={() => void verifyAgain()} disabled={working} className="gc-button gc-button-quiet text-[10px]">
              <RefreshCw className={`h-3 w-3 ${working ? "animate-spin" : ""}`} /> {hasTemporaryAccess ? "Retry access check" : "Verify again"}
            </button>}
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
        </details>
      )}

      <button
        type="button"
        onClick={onComplete}
        disabled={working || !ready}
        className="w-full rounded-md border border-accent/30 bg-accent/10 py-3 text-sm font-mono text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {hasTemporaryAccess ? "Continue for now" : "Continue to server scan →"}
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
  disabled = false,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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

// A retained handoff is an origin, never a one-time claim link. Keep secrets out
// of rendered text and hrefs even if an older status contains a path/fragment.
function publicHttpsOrigin(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}
