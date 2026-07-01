"use client";

import { ProjectsPanel } from "@/components/ProjectsPanel";

export default function ProjectsPage() {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Deployments</h1>
        <p className="text-muted mt-1">Managed deployments, discovered apps, and invalid compose folders</p>
      </div>
      <ProjectsPanel />
    </div>
  );
}
