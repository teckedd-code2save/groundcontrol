"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard, { AuthButton, AuthError, AuthInput } from "@/components/AuthCard";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";

type ClaimStatus = {
  instanceId: string;
  claimed: boolean;
  claimRequired: boolean;
  setupRequired: boolean;
  activeClaim?: {
    id: string;
    expiresAt: string;
    createdAt: string;
  } | null;
};

function fragmentToken() {
  if (typeof window === "undefined") return "";
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return "";
  const params = new URLSearchParams(raw);
  return params.get("token") || (raw.startsWith("gc_claim_") ? raw : "");
}

export default function ClaimPage() {
  const router = useRouter();
  const [status, setStatus] = useState<ClaimStatus | null>(null);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const found = fragmentToken();
    if (found) {
      setToken(found);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    fetch("/api/auth/claim", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not read claim status");
        return data as ClaimStatus;
      })
      .then((data) => {
        setStatus(data);
        if (data.claimed) router.replace("/login");
        else if (!data.claimRequired && data.setupRequired) router.replace("/setup");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setChecking(false));
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not claim GroundControl");
      router.replace(data.next || "/onboarding");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <LoaderOverlay3D
        open
        title="Checking this GroundControl instance…"
        subtitle="Verifying the one-time installation claim."
      />
    );
  }

  return (
    <AuthCard
      title="Claim GroundControl"
      subtitle="Create the first administrator for this installation"
      footer="The installation claim is single-use. Infrastructure access stays locked until this step succeeds."
    >
      <form onSubmit={submit} className="space-y-5">
        {status?.instanceId && (
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/35">Instance</p>
            <p className="mt-1 break-all font-mono text-xs text-white/65">{status.instanceId}</p>
            {status.activeClaim?.expiresAt && (
              <p className="mt-2 text-[10px] text-white/35">
                Claim expires {new Date(status.activeClaim.expiresAt).toLocaleString()}
              </p>
            )}
          </div>
        )}

        <AuthInput
          label="One-time claim code"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="gc_claim_…"
          autoFocus={!token}
        />

        <AuthInput
          label="Administrator username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus={Boolean(token)}
        />

        <div>
          <AuthInput
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••••"
          />
          <p className="mt-1.5 text-[10px] text-white/30">
            Min 12 characters, uppercase, lowercase, number, and symbol.
          </p>
        </div>

        <AuthInput
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="••••••••••••"
        />

        <AuthError message={error} />
        <AuthButton loading={loading}>Claim this instance</AuthButton>
      </form>
    </AuthCard>
  );
}
