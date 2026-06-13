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
    { icon: "🛰️", label: "Fleet Control", desc: "One hub for every VPS" },
    { icon: "📦", label: "Container Ops", desc: "Start, stop, deploy" },
    { icon: "🗄️", label: "Databases", desc: "Monitor state at a glance" },
    { icon: "🌩️", label: "Proxy & Cloud", desc: "Caddy, Nginx, Cloudflare" },
  ];

  return (
    <div className="flex flex-col gap-4 max-w-sm">
      <h2 className="text-2xl lg:text-3xl font-bold text-white/90 tracking-tight drop-shadow-lg">
        Mission control<br />for your servers.
      </h2>
      <p className="text-sm text-white/40 max-w-xs leading-relaxed">
        GroundControl turns your VPS fleet into a live, clickable topology you can operate from anywhere.
      </p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/5 px-4 py-3 backdrop-blur-sm"
          >
            <span className="text-lg">{item.icon}</span>
            <div>
              <div className="text-sm font-semibold text-white/80">{item.label}</div>
              <div className="text-xs text-white/40">{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
