"use client";

import { DeploymentWorkspace } from "@/components/DeploymentWorkspace";
import { PageHeader } from "@/components/PageHeader";

export default function DeploymentsPage() {
  return (
    <div className="gc-page gc-page--wide">
      <PageHeader
        eyebrow="Workloads"
        title="Deployments"
        description="Enrol, operate, configure, and verify the workloads running across your hosts."
      />
      <DeploymentWorkspace />
    </div>
  );
}
