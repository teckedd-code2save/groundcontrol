"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard, { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";

export default function SetupPage() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/setup")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.setupRequired) {
          router.push("/login");
        }
      })
      .catch(() => router.push("/login"))
      .finally(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError(data.error || "Setup failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <LoaderOverlay3D
        open
        title="Checking setup status…"
        subtitle="GroundControl is verifying whether an administrator account already exists."
      />
    );
  }

  return (
    <AuthCard
      title="Welcome"
      subtitle="Create the first admin account"
      footer="This account has full control over your servers."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthInput
          label="Username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />

        <div>
          <AuthInput
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
          />
          <p className="mt-1.5 text-[10px] text-white/30">
            Min 12 characters, uppercase, lowercase, number, and symbol.
          </p>
        </div>

        <AuthInput
          label="Confirm Password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••••••"
        />

        <AuthError message={error} />

        <AuthButton loading={loading}>Create Admin Account</AuthButton>
      </form>
    </AuthCard>
  );
}
