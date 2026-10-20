"use client";

import { useState } from "react";
import { ArrowRight, Boxes, LockKeyhole, Monitor, RefreshCw } from "lucide-react";
import { Button, Notice, StatusBadge } from "@/components/ui";

export default function LocalWorkspaceSetup({ onComplete }: { onComplete: () => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<string[]>([]);

  async function startScan() {
    setWorking(true);
    setError("");
    setDetails([]);
    try {
      const response = await fetch("/api/instance/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify" }),
      });
      const data = await response.json();
      if (!response.ok || !data.verification?.ok) {
        const checks = Object.values(data.verification?.checks || {}) as { status: string; detail: string }[];
        setDetails(checks.filter((check) => check.status === "failed").map((check) => check.detail));
        throw new Error("The workspace check did not finish. Make sure Docker is running, then try again.");
      }
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach GroundControl. Check that Docker is running and try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section aria-labelledby="workspace-title">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
        <Monitor size={24} aria-hidden="true" />
      </div>
      <h1 id="workspace-title" className="text-3xl font-semibold tracking-tight">Your workspace is ready</h1>
      <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
        GroundControl is running on this computer. Let’s find the Docker apps you can manage here.
      </p>

      <div className="my-7 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <span className="text-sm font-medium">This computer</span>
          <StatusBadge tone="success">Installed</StatusBadge>
        </div>
        <div className="flex gap-3 p-5">
          <LockKeyhole size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Only on this computer</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">Your dashboard uses a private local link. Keep Docker running to use it.</p>
          </div>
        </div>
        <div className="flex gap-3 border-t border-border p-5">
          <Boxes size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Next: discover your apps</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">We’ll check the workspace and look for running containers and projects in your shared folder.</p>
          </div>
        </div>
      </div>

      {error && (
        <Notice tone="danger" className="mb-4" title="Let’s try that again">
          <p>{error}</p>
          {details.length > 0 && <details className="mt-2"><summary className="cursor-pointer">Check details</summary><ul className="mt-2 list-disc space-y-1 pl-4">{details.map((detail, i) => <li key={i}>{detail}</li>)}</ul></details>}
        </Notice>
      )}
      <Button
        variant="primary"
        className="min-h-12! text-sm! w-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        onClick={() => void startScan()}
        disabled={working}
        trailingIcon={working ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
      >
        {working ? "Checking your workspace…" : error ? "Try again" : "Scan my Docker apps"}
      </Button>
      <p aria-live="polite" className="mt-3 text-center text-xs leading-relaxed text-muted">
        {working ? "Checking that GroundControl is ready before starting the scan." : "The scan won’t change or restart your apps."}
      </p>
      <p className="mt-7 border-t border-border pt-5 text-sm leading-relaxed text-muted">
        Have a Linux server too? Add it later in Settings → Connections.
      </p>
    </section>
  );
}
