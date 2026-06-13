"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthCard, { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/setup")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.setupRequired) {
          router.push("/setup");
          return;
        }
        fetch("/api/auth/me")
          .then((res) => {
            if (res.ok) router.push("/dashboard");
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.forcePasswordChange) {
          router.push("/force-password-change");
        } else {
          router.push("/dashboard");
        }
      } else {
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="GroundControl"
      subtitle="Self-hosted VPS cockpit"
      footer="Secure your fleet from a single pane of glass."
      layout="split"
      leftPanel={<StoryPanel />}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthInput
          label="Username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="admin"
          autoFocus
        />

        <AuthInput
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        <AuthError message={error} />

        <AuthButton loading={loading}>Sign In</AuthButton>
      </form>
    </AuthCard>
  );
}

function StoryPanel() {
  const items = [
    { label: "Fleet" },
    { label: "Containers" },
    { label: "Proxy" },
    { label: "Cloud" },
  ];

  return (
    <div className="flex flex-col gap-2 max-w-xs">
      <h2 className="text-xl font-bold text-white/90 tracking-tight drop-shadow-lg">
        Mission control for your fleet.
      </h2>
      <p className="text-xs text-white/40 leading-relaxed">
        Live topology, container ops, reverse proxy, and AI-assisted deployments from one dashboard.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item.label}
            className="px-2 py-1 rounded-md bg-white/[0.04] border border-white/10 text-[10px] font-mono uppercase tracking-wider text-white/50"
          >
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
