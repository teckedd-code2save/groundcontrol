"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) {
          router.push("/login");
          return null;
        }
        return fetch("/api/vps").then((r) => (r.ok ? r.json() : []));
      })
      .then((configs) => {
        if (configs && Array.isArray(configs) && configs.length === 0) {
          router.push("/onboarding");
        } else if (configs) {
          router.push("/dashboard");
        }
      })
      .catch(() => router.push("/login"));
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent animate-pulse" />
        <span className="text-sm font-mono text-muted">Loading...</span>
      </div>
    </div>
  );
}
