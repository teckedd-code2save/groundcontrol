"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface MeResponse {
  id: number;
  username: string;
  role: string;
  forcePasswordChange?: boolean;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  const publicPaths = ["/login", "/setup"];
  const isPublic = publicPaths.includes(pathname);

  useEffect(() => {
    if (isPublic) {
      setAuthChecked(true);
      setAuthenticated(false);
      return;
    }

    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) {
          router.push("/login");
          return null;
        }
        return res.json() as Promise<MeResponse>;
      })
      .then((user) => {
        if (!user) return;
        setAuthenticated(true);
        if (user.forcePasswordChange && pathname !== "/force-password-change") {
          router.push("/force-password-change");
        }
      })
      .catch(() => router.push("/login"))
      .finally(() => setAuthChecked(true));
  }, [pathname, router, isPublic]);

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

  // On public pages, render children without layout wrapper
  if (isPublic) {
    return <>{children}</>;
  }

  // Not authenticated and not on a public page: don't render anything while redirecting
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
