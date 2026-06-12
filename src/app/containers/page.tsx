"use client";

import { ContainersPanel } from "@/components/ContainersPanel";

export default function ContainersPage() {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Containers</h1>
        <p className="text-muted mt-1">Manage Docker containers and images on your VPS</p>
      </div>
      <ContainersPanel />
    </div>
  );
}
