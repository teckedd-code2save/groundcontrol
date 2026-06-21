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
    <div className="flex flex-col gap-5 max-w-md">
      <div className="sr-eyebrow">AI-assisted operations</div>
      <h2
        className="sr-display text-3xl lg:text-4xl xl:text-5xl font-medium tracking-tight leading-[1.05]"
        style={{ color: "var(--sr-text-90)" }}
      >
        A container that learned to drive the host.
      </h2>
      <p
        className="text-base leading-relaxed max-w-sm"
        style={{ color: "var(--sr-text-55)" }}
      >
        GroundControl runs inside Docker, talks to the host OS through a one-shot namespace bridge, and gives you a real VPS cockpit from the browser.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item.label}
            className="sr-mono px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest"
            style={{
              background: "var(--sr-stone)",
              color: "var(--sr-text-55)",
            }}
          >
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
