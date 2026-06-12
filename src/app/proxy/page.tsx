"use client";

import { ProxyPanel } from "@/components/ProxyPanel";

export default function ProxyPage() {
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Reverse Proxy</h1>
        <p className="text-muted mt-1">Manage Caddy and Nginx configurations on your VPS</p>
      </div>
      <ProxyPanel />
    </div>
  );
}
