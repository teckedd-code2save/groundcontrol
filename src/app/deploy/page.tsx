"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DeployRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/deployments");
  }, [router]);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <p className="text-muted text-sm">Deploy has moved to Deployments. Redirecting...</p>
    </div>
  );
}
