"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthCard, { AuthButton, AuthError, AuthInput } from "@/components/AuthCard";

type InstanceStatus = {
  instanceId?: string;
  claimed?: boolean;
  claimRequired?: boolean;
  setupRequired?: boolean;
};

const PUBLIC_SITE = "https://trygroundcontrol.serendepify.com";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [instance, setInstance] = useState<InstanceStatus | null>(null);
  const [host, setHost] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setHost(window.location.host);

    fetch("/api/auth/claim", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as InstanceStatus;
      })
      .then((status) => {
        if (!status) return;
        setInstance(status);
        if (!status.claimed && status.claimRequired) {
          window.location.replace("/claim");
        } else if (!status.claimed && status.setupRequired) {
          window.location.replace("/setup");
        }
      })
      .catch(() => {
        // Login remains available even if instance metadata cannot be read.
      });
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const next = new URLSearchParams(window.location.search).get("next") || undefined;
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, next }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Invalid credentials");
        return;
      }

      const data = await response.json().catch(() => ({}));
      const destination = data.next || (data.forcePasswordChange ? "/force-password-change" : "/dashboard");
      window.location.assign(destination);
    } catch {
      setError("Could not reach this GroundControl instance.");
    } finally {
      setLoading(false);
    }
  }

  const instanceLabel = instance?.instanceId
    ? `Instance ${instance.instanceId.slice(0, 12)}`
    : "Private control plane";

  return (
    <AuthCard
      title="Sign in"
      subtitle={host ? `${host} · private GroundControl` : "Private GroundControl instance"}
      footer={
        <span>
          This is a single-tenant operator console.{" "}
          <Link href={PUBLIC_SITE} className="text-[var(--accent)] hover:text-[var(--accent-bright)]">
            Need your own GroundControl?
          </Link>
        </span>
      }
    >
      <div className="mb-5 rounded-md border border-[var(--line)] bg-[var(--bg-dark)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
            Operator access
          </span>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
        </div>
        <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">{instanceLabel}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthInput
          label="Username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoFocus
          required
        />

        <AuthInput
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />

        <AuthError message={error} />
        <AuthButton loading={loading}>Enter control plane</AuthButton>
      </form>

      <p className="mt-5 text-center text-[10px] leading-relaxed text-[var(--text-dim)]">
        Agents connect through scoped MCP/OAuth grants. This login is for the human operator of this instance.
      </p>
    </AuthCard>
  );
}
