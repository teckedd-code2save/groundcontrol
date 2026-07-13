"use client";

import { ProjectsPanel } from "@/components/ProjectsPanel";
import { PageHeader } from "@/components/PageHeader";

export default function DeploymentsPage() {
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <PageHeader
        title="Deployments"
        description="Enrol, operate, configure, and verify the workloads running across your hosts."
      />
      <ProjectsPanel />
    </div>
  );
}
