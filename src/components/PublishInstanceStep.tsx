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
  localDesktop?: boolean;
  mode: PublishMethod;
  directIpv4Enabled?: boolean;
  directIpv4Evidence?: { publicUrl: string; checkedAt: string; priorUrl: string } | null;
  publicUrl: string | null;
  claimed: boolean;
  cloudflareConfigured: boolean;
  cloudflareAccountId?: string | null;
  lastVerification?: Verification | null;
};

type PublishMethod = "caddy" | "cloudflare" | "quick_tunnel" | "private" | "direct_ipv4";
type DirectCandidate = { url: string; instanceId: string; challenge: string; expiresAt: string; caddyfile: string };

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
  const [directIp, setDirectIp] = useState("");
  const [directConfirmed, setDirectConfirmed] = useState(false);
  const [externalConfirmed, setExternalConfirmed] = useState(false);
  const [removedDirectRoute, setRemovedDirectRoute] = useState(false);
  const [directProof, setDirectProof] = useState("");
  const [directCandidate, setDirectCandidate] = useState<DirectCandidate | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [requiredRecord, setRequiredRecord] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [workingLabel, setWorkingLabel] = useState("Verifying…");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function load(preserveSelection = false) {
    setLoading(true);
    try {
      const response = await fetch("/api/instance/publish", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load publish status");
      setStatus(data);
      if (!preserveSelection && (data.localDesktop || data.mode === "private")) {
        setMethod(current => data.localDesktop || current === "direct_ipv4" ? "private" : current);
      }
      setVerification(data.lastVerification || null);
      if (!preserveSelection && data.mode === "quick_tunnel") setHostname("");
      if (!preserveSelection && data.publicUrl && data.mode !== "quick_tunnel") {
        try {
          const parsed = new URL(data.publicUrl);
          setHostname(parsed.hostname);
        } catch {}
      }
      if (!preserveSelection && data.mode && data.mode !== "private") setMethod(data.mode);
      if (!preserveSelection && data.directIpv4Enabled && (!data.mode || ["private", "quick_tunnel"].includes(data.mode))) {
        setMethod("direct_ipv4");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load publish status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const hasTemporaryAccess = status?.mode === "quick_tunnel" && Boolean(status.publicUrl);

  async function publish() {
    if (method === "quick_tunnel" && hasTemporaryAccess) {
      await verifyAgain();
      return;
    }
    setWorkingLabel(method === "direct_ipv4" ? "Checking setup…" : method === "private" ? "Verifying private access…" : "Publishing & verifying…");
    setWorking(true);
    setError("");
    setRequiredRecord(null);
    try {
      const payload: Record<string, unknown> = { action: method };
      if (method === "direct_ipv4") {
        Object.assign(payload, directCandidate
          ? { action: "adopt_direct_ipv4", proof: directProof.trim(), confirmed: externalConfirmed }
          : { action: "prepare_direct_ipv4", ip: directIp.trim(), confirmed: directConfirmed });
      }
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

      if (data.candidate) {
        setDirectCandidate(data.candidate);
        return;
      }
      setDirectCandidate(null);
      setDirectProof("");
      setVerification(data.verification || null);
      await load();
    } catch (cause) {
      // A replacement may be live even when retiring an old path needs attention.
      // Reload authoritative status rather than leaving a stale handoff link visible.
      await load(true);
      setError(cause instanceof Error ? cause.message : "Could not publish GroundControl");
    } finally {
      setWorking(false);
    }
  }

  async function forgetDirectAddress() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/instance/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "forget_direct_ipv4", confirmed: removedDirectRoute }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not forget the address");
      setRemovedDirectRoute(false);
      await load();
    } catch (cause) {
      await load(true);
      setError(cause instanceof Error ? cause.message : "Could not forget the address");
    } finally {
      setWorking(false);
    }
  }

  async function verifyAgain() {
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
      {status?.localDesktop && (
        <div className="border border-border bg-card p-5 text-sm leading-relaxed text-muted">
          <p className="font-medium text-foreground">GroundControl is running on this computer</p>
          <p className="mt-2">Use your local login link while Docker is running. This workspace manages Docker workloads; it does not manage native Mac or Windows services. You can add a remote Linux server later in Connections.</p>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {status?.directIpv4Enabled && (!status.publicUrl || hasTemporaryAccess) && (
          <MethodCard
            active={method === "direct_ipv4"}
            icon={<Globe2 className="h-4 w-4" />}
            title="Use my server’s reserved IP"
            detail="Experimental. Use a public IPv4 you already have, without buying a domain."
            onClick={() => setMethod("direct_ipv4")}
          />
        )}
        {!status?.localDesktop && status?.mode !== "direct_ipv4" && <>
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
          title={hasTemporaryAccess ? "Temporary HTTPS is already set up" : "No domain yet"}
          detail={hasTemporaryAccess ? "Use your existing link. Verify it below, or configure a permanent domain." : "Temporary public HTTPS for setup. Configure a permanent domain for ongoing access."}
          onClick={() => setMethod("quick_tunnel")}
        />
        </>}
        {!hasTemporaryAccess && status?.mode !== "direct_ipv4" && <MethodCard
          active={method === "private"}
          icon={<LockKeyhole className="h-4 w-4" />}
          title="Keep it private"
          detail="Use local/SSH access only. External MCP clients will not be able to reach it yet."
          onClick={() => setMethod("private")}
        />}
      </div>

      {method === "direct_ipv4" && status?.mode !== "direct_ipv4" && (
        <section className="space-y-3 border border-border bg-card p-5">
          {!directCandidate ? <>
            <label className="gc-label" htmlFor="gc-publish-ip">Reserved public IPv4</label>
            <input id="gc-publish-ip" value={directIp} onChange={(event) => setDirectIp(event.target.value)}
              className="gc-field w-full font-mono" placeholder="Enter the address shown by your VPS provider" />
            <label className="flex items-start gap-2 text-xs text-muted">
              <input type="checkbox" checked={directConfirmed} onChange={(event) => setDirectConfirmed(event.target.checked)} />
              My VPS provider shows this as a reserved public IPv4. I can configure inbound HTTPS on port 443.
            </label>
            <p className="text-xs text-muted">This prepares a Caddy route for you to review and apply. GroundControl will not install Caddy, change your firewall or replace existing routes.</p>
          </> : <>
            <p className="text-xs text-muted">Add this site block to your existing Caddy configuration without replacing other sites. Keep Caddy’s certificate storage persistent. This opens the signed-in dashboard on public HTTPS; port 3003 stays private.</p>
            <pre className="overflow-auto border border-border p-3 text-xs" tabIndex={0}>{directCandidate.caddyfile}</pre>
            <p className="text-xs text-muted">On a different machine with Python 3, run this from the candidate source checkout, then enter the challenge when prompted. It expires at {new Date(directCandidate.expiresAt).toLocaleTimeString()}.</p>
            <pre className="overflow-auto border border-border p-3 text-xs" tabIndex={0}>python3 scripts/check-direct-ipv4.py {new URL(directCandidate.url).hostname} {directCandidate.instanceId}</pre>
            <p className="break-all font-mono text-xs text-muted">Challenge: {directCandidate.challenge}</p>
            <label htmlFor="gc-ip-proof" className="gc-label">Verification proof</label>
            <input id="gc-ip-proof" value={directProof} onChange={(event) => setDirectProof(event.target.value)}
              maxLength={64} autoComplete="off" className="gc-field w-full font-mono" />
            <label className="flex items-start gap-2 text-xs text-muted">
              <input type="checkbox" checked={externalConfirmed} onChange={(event) => setExternalConfirmed(event.target.checked)} />
              I ran the check outside this VPS. Keep my previous route and save this as the management address.
            </label>
            <button type="button" disabled={working} onClick={() => {
              setDirectCandidate(null); setDirectProof(""); setExternalConfirmed(false);
            }} className="gc-button gc-button-quiet">Start a new check</button>
          </>}
        </section>
      )}

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
        {status?.mode !== "direct_ipv4" && <button
          type="button"
          onClick={() => void publish()}
          disabled={
            working ||
            (method === "direct_ipv4" && (directCandidate ? !externalConfirmed || directProof.trim().length !== 64 : !directConfirmed || !directIp.trim())) ||
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
                ? hasTemporaryAccess ? "Verify existing access" : "Create temporary HTTPS"
                : method === "direct_ipv4" ? directCandidate ? "Save verified address" : "Prepare IPv4 setup" : "Publish & verify"}
        </button>}
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
          {status.mode === "direct_ipv4" && (
            <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted">
              <p>GroundControl saved the address after an operator-run TLS and identity check. Reconnect external agents to the new address; this does not migrate or revoke old OAuth grants.</p>
              {!verification && <button type="button" disabled={working} onClick={() => void verifyAgain()} className="gc-button gc-button-quiet">Check local readiness</button>}
              {status.directIpv4Evidence?.priorUrl && <p>Previous dashboard route retained: <a href={status.directIpv4Evidence.priorUrl} className="underline" target="_blank" rel="noreferrer">{status.directIpv4Evidence.priorUrl}</a>. Temporary links can stop working after a reboot.</p>}
              <p>GroundControl does not manage this Caddy route or firewall. Keep the IP reserved and Caddy’s certificate renewal running.</p>
              <details className="space-y-2">
                <summary className="cursor-pointer">Remove this address from GroundControl</summary>
                <p>Open the previous login route or SSH recovery first. Remove only the IPv4 site block and reload Caddy. Then forget the saved address here. This step does not remove or check the route itself.</p>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={removedDirectRoute} onChange={(event) => setRemovedDirectRoute(event.target.checked)} />
                  I have removed the Caddy route.
                </label>
                <button type="button" disabled={!removedDirectRoute || working} onClick={() => void forgetDirectAddress()} className="gc-button gc-button-quiet">Forget IPv4 address</button>
              </details>
            </div>
          )}
          {status.mode === "quick_tunnel" && (
            <div className="mt-3 space-y-2 text-xs leading-relaxed text-warning">
              <p className="font-medium">Temporary access: configure a permanent domain</p>
              <p>This is a public HTTPS sign-in link, not a private-only address. You can close the setup terminal; GroundControl and this tunnel run on the server.</p>
              <p>This temporary connector does not restart automatically after a server reboot. Recreating it gives you a new URL, so bookmarks and agent connections may need updating.</p>
              <p>Quick tunnels have no uptime guarantee and do not support server-sent event streams. Use a permanent domain with a named Cloudflare Tunnel or HTTPS proxy for ongoing access and agents.</p>
              <button type="button" onClick={() => setMethod("cloudflare")} disabled={working} className="gc-button gc-button-quiet text-[10px]">
                Set up a permanent domain
              </button>
            </div>
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
        disabled={working || !verification?.ok}
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
