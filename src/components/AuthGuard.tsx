"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (pathname === "/login") {
      setAuthChecked(true);
      setAuthenticated(false);
      return;
    }

    fetch("/api/auth/me")
      .then((res) => {
        if (res.ok) {
          setAuthenticated(true);
        } else {
          router.push("/login");
        }
      })
      .catch(() => router.push("/login"))
      .finally(() => setAuthChecked(true));
  }, [pathname, router]);

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent animate-pulse" />
          <span className="text-sm font-mono text-muted">Loading...</span>
        </div>
      </div>
    );
  }

  // On login page, render children without layout wrapper
  if (pathname === "/login") {
    return <>{children}</>;
  }

  // Not authenticated and not on login page: don't render anything while redirecting
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent animate-pulse" />
          <span className="text-sm font-mono text-muted">Redirecting...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
