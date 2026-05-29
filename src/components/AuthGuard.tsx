"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (pathname === "/login") {
      setLoading(false);
      return;
    }

    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) {
          router.push("/login");
        }
      })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  }, [pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent animate-pulse" />
          <span className="text-sm font-mono text-muted">Loading...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
