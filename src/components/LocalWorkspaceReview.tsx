"use client";

import { ArrowRight, Box, Check, RefreshCw } from "lucide-react";
import { Button, Notice, StatusBadge } from "@/components/ui";

export type WorkspaceScan = {
  containers: { name: string; image: string; status?: string; state?: string }[];
  projects: { path: string }[];
};

export default function LocalWorkspaceReview({ result, onRetry, onComplete, onConnect }: {
  result: WorkspaceScan | null;
  onRetry: () => void;
  onComplete: () => void;
  onConnect: () => void;
}) {
  if (!result) return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight">We couldn’t finish the scan</h1>
      <Notice tone="warning" className="my-6">Check that Docker is running, then scan again. Your apps haven’t been changed.</Notice>
      <Button variant="primary" className="min-h-12! text-sm! w-full" onClick={onRetry}>Try the scan again</Button>
    </section>
  );
  const count = result.containers.length;
  return (
    <section aria-labelledby="workspace-review-title">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-success/25 bg-success/10 text-success">
        <Check size={24} aria-hidden="true" />
      </div>
      <h1 id="workspace-review-title" className="text-3xl font-semibold tracking-tight">You’re ready to explore</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {count ? `Found ${count} running Docker ${count === 1 ? "container" : "containers"} on this computer. Open your dashboard to view status, logs, and settings.` : "Your Docker workspace is connected. Open the dashboard to get started with your first app."}
      </p>
      <div className="my-7 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-sm font-medium">Docker on this computer</h2>
          <StatusBadge tone="success">Connected</StatusBadge>
        </div>
        {count > 0 ? (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {result.containers.map((container) => (
              <li key={container.name} className="flex items-start gap-3 p-4">
                <Box size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{container.name}</p>
                  <p className="mt-1 break-all text-xs leading-relaxed text-muted">{container.image}</p>
                  {container.status && <p className="mt-2 text-xs text-muted">{container.status}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="p-5 text-sm text-muted">No running containers found yet.</p>}
        <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted">
          {result.projects.length ? `${result.projects.length} ${result.projects.length === 1 ? "project" : "projects"} found in your shared folder.` : "Projects you add to your shared folder will appear here on your next scan."}
        </p>
      </div>
      <Button variant="primary" className="min-h-12! text-sm! w-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent" onClick={onComplete} trailingIcon={<ArrowRight size={16} aria-hidden="true" />}>Open dashboard</Button>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button variant="quiet" onClick={onRetry} leadingIcon={<RefreshCw size={14} aria-hidden="true" />}>Scan again</Button>
        <Button variant="quiet" onClick={onConnect}>Add a remote server</Button>
      </div>
      <p className="mt-6 text-center text-xs leading-relaxed text-muted">Your dashboard stays private to this computer.</p>
    </section>
  );
}
