"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard, { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";

export default function ForcePasswordChangePage() {
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => {
        if (!user?.forcePasswordChange) {
          router.push("/dashboard");
          return;
        }
        if (user.username) setEmail(user.username);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (newPassword !== confirm) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          newUsername: email.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError(data.error || "Failed to update account");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Secure your account"
      subtitle="Choose the email and password you'll use from now on"
      badge="!"
      badgeColor="from-amber-500 via-orange-500 to-red-500"
      footer="These bootstrap credentials are temporary — update them before you continue."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthInput
          label="Email / username"
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoFocus
        />

        <AuthInput
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Temporary password from install"
        />

        <div>
          <AuthInput
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••••••"
          />
          <p className="mt-1.5 text-[10px] text-white/30">
            Min 12 characters, uppercase, lowercase, number, and symbol.
          </p>
        </div>

        <AuthInput
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••••••"
        />

        <AuthError message={error} />

        <AuthButton loading={loading}>Save and continue</AuthButton>
      </form>
    </AuthCard>
  );
}
