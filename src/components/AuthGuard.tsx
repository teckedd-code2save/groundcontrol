"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/SidebarContext";
import { MainLayout } from "@/components/MainLayout";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";

interface MeResponse {
  id: number;
  username: string;
  role: string;
  forcePasswordChange?: boolean;
}

const PUBLIC_PATHS = ["/login", "/setup"];
const NO_LAYOUT_PATHS = ["/login", "/setup", "/force-password-change"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const noLayout = NO_LAYOUT_PATHS.includes(pathname);

  const [authChecked, setAuthChecked] = useState(isPublic);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (isPublic) return;

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
    return <LoaderOverlay3D open title="Checking your session…" subtitle="GroundControl is verifying access to this control plane." />;
  }

  // Public pages: render content without app layout
  if (isPublic) {
    return <>{children}</>;
  }

  // Not authenticated and not on a public page: don't render anything while redirecting
  if (!authenticated) {
    return <LoaderOverlay3D open title="Redirecting securely…" subtitle="The authenticated workspace is not available for this session." />;
  }

  // Authenticated special pages (e.g. force-password-change): no sidebar/layout
  if (noLayout) {
    return <>{children}</>;
  }

  // Authenticated app pages: full layout
  return (
    <SidebarProvider>
      <Sidebar />
      <MainLayout>{children}</MainLayout>
    </SidebarProvider>
  );
}
