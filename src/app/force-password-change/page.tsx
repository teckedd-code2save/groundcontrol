"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LoginHero3D from "@/components/LoginHero3D";

export default function ForcePasswordChangePage() {
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
        }
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
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError(data.error || "Failed to update password");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <LoginHero3D />

      <div className="relative z-10 w-full max-w-md px-4 sm:px-0">
        <div className="login-card-glow rounded-2xl p-[1px]">
          <div className="bg-card/80 backdrop-blur-xl border border-border/50 rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="relative w-12 h-12 rounded-xl bg-warning flex items-center justify-center text-white font-bold text-lg orb-pulse">
                <span className="relative z-10">!</span>
                <div className="absolute inset-0 rounded-xl bg-warning opacity-40 blur-lg" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Password Change Required</h1>
                <p className="text-xs text-muted font-mono uppercase tracking-wider">
                  Update your password to continue
                </p>
              </div>
            </div>

            <p className="text-sm text-muted mb-6 leading-relaxed">
              Your account is using a setup or legacy password that must be changed before you can access
              the dashboard.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-muted mb-1.5">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-background/60 border border-border rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                  placeholder="••••••••••••"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-muted mb-1.5">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-background/60 border border-border rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                  placeholder="••••••••••••"
                />
                <p className="text-[10px] text-muted mt-1.5">
                  Min 12 characters, uppercase, lowercase, number, and symbol.
                </p>
              </div>
              <div>
                <label className="block text-xs font-mono text-muted mb-1.5">Confirm New Password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-background/60 border border-border rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                  placeholder="••••••••••••"
                />
              </div>

              {error && (
                <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-error text-sm animate-shake">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full py-2.5 bg-accent text-white rounded-lg hover:bg-accent/90 transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update Password"
                  )}
                </span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
