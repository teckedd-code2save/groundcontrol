"use client";

import { useState } from "react";
import { Activity, Plus, Trash2 } from "lucide-react";
import { ModalSurface } from "@/components/ModalSurface";
import { Button, EmptyState, FormField, Notice, StatusBadge, Surface, SurfaceHeader, Tabs } from "@/components/ui";

type LabTab = "overview" | "environment" | "releases";

export function ComponentLab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState<LabTab>("overview");

  return (
    <div className="gc-page space-y-8">
      <header className="border-b border-border pb-5">
        <p className="gc-eyebrow">Internal interface contract</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Component states</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          A development-only reference for shared GroundControl interaction and status states.
        </p>
      </header>

      <Surface>
        <SurfaceHeader>
          <div>
            <p className="gc-eyebrow">Actions</p>
            <h2 className="mt-1 text-sm font-medium">Hierarchy and consequence</h2>
          </div>
        </SurfaceHeader>
        <div className="flex flex-wrap gap-3 p-5">
          <Button variant="primary" leadingIcon={<Plus size={14} />}>Primary action</Button>
          <Button>Secondary action</Button>
          <Button variant="quiet">Quiet action</Button>
          <Button variant="danger" leadingIcon={<Trash2 size={14} />} onClick={() => setDialogOpen(true)}>Destructive action</Button>
          <Button disabled>Disabled action</Button>
        </div>
      </Surface>

      <div className="grid gap-6 lg:grid-cols-2">
        <Surface>
          <SurfaceHeader><h2 className="text-sm font-medium">Feedback</h2></SurfaceHeader>
          <div className="space-y-3 p-5">
            <Notice>Neutral context that helps an operator make a decision.</Notice>
            <Notice tone="info" title="Investigation ready">Evidence is available for this change.</Notice>
            <Notice tone="success">The public journey passed after deployment.</Notice>
            <Notice tone="warning">One required connector still needs configuration.</Notice>
            <Notice tone="danger">The deployment could not be verified.</Notice>
          </div>
        </Surface>

        <Surface>
          <SurfaceHeader><h2 className="text-sm font-medium">Status and fields</h2></SurfaceHeader>
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap gap-2">
              <StatusBadge>Unknown</StatusBadge>
              <StatusBadge tone="info">Investigating</StatusBadge>
              <StatusBadge tone="success">Verified</StatusBadge>
              <StatusBadge tone="warning">Degraded</StatusBadge>
              <StatusBadge tone="danger">Failed</StatusBadge>
            </div>
            <FormField label="Public endpoint" hint="The customer-facing URL used for external verification.">
              <input placeholder="https://app.example.com" />
            </FormField>
            <FormField label="Required secret" error="Add a value before deployment.">
              <input type="password" placeholder="Write-only value" />
            </FormField>
          </div>
        </Surface>
      </div>

      <Surface>
        <Tabs<LabTab>
          label="Deployment sections"
          items={[
            { id: "overview", label: "Overview" },
            { id: "environment", label: "Environment", meta: "12" },
            { id: "releases", label: "Releases", meta: "3" },
          ]}
          value={tab}
          onChange={setTab}
          className="px-3"
        />
        <div className="p-5 text-sm text-muted">Selected: <span className="font-mono text-foreground">{tab}</span></div>
      </Surface>

      <EmptyState
        icon={<Activity size={20} />}
        title="No operational evidence yet"
        description="Connect a host or run a scan. GroundControl will not invent activity when no evidence exists."
        action={<Button variant="primary">Scan host</Button>}
      />

      <ModalSurface
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Delete deployment"
        description="perfume-emporio"
        size="sm"
        tone="danger"
        footer={
          <>
            <Button variant="quiet" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setDialogOpen(false)}>Delete deployment</Button>
          </>
        }
      >
        <Notice tone="danger" title="Permanent action">Release history and deployment identity will be removed.</Notice>
      </ModalSurface>
    </div>
  );
}

