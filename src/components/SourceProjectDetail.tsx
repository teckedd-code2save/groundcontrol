"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, FolderGit2, RefreshCw } from "lucide-react";
import { Notice } from "./ui";
import type { SourceProject } from "@/lib/source-discovery";

export function SourceProjectDetail({ name, sourcePath, initialSource, hostId }: {
  name: string; sourcePath: string; initialSource?: SourceProject | null; hostId?: number | null;
}) {
  const [source, setSource] = useState(initialSource);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/deployment-inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "inspect_folder", sourcePath, hostId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check the folder.");
      setSource(data.folder); setMessage("Folder is accessible. Project details refreshed.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not check the folder."); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
    <Link href="/projects" className="gc-button gc-button-quiet"><ArrowLeft size={14} />Projects</Link>
    <header className="border-b border-border pb-6"><p className="mb-2 text-xs text-muted">Existing project</p><h1 className="text-3xl font-semibold tracking-tight">{name}</h1><p className="mt-3 text-sm text-muted">Source added · not deployed</p></header>
    {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
    {message && <div role="status"><Notice tone="success">{message}</Notice></div>}
    <section className="space-y-4 border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-base font-medium"><FolderGit2 size={18} />Project folder</h2>
      <p className="break-all font-mono text-xs text-muted">{sourcePath}</p>
      <p className="text-sm">{source?.technologies.join(" · ") || "Project folder"}</p>
      {Boolean(source?.markers.length) && <details className="text-xs text-muted"><summary className="cursor-pointer">Detected project files</summary><ul className="mt-3 space-y-1">{source!.markers.map((marker) => <li key={marker}>{marker}</li>)}</ul></details>}
      <button type="button" disabled={busy} onClick={() => void check()} className="gc-button gc-button-secondary"><RefreshCw size={14} />{busy ? "Checking…" : "Check folder again"}</button>
    </section>
    <section className="space-y-3"><h2 className="text-base font-medium">Deployment is a separate step</h2><p className="text-sm leading-relaxed text-muted">Your source stays in its original folder. Adding it does not install dependencies or run your app. Automatic deployment from a local source folder is not available yet. If you already run it in Docker, refresh discovery to find and manage its containers.</p><Link href="/deployments" className="gc-button gc-button-primary">View projects and deployments</Link></section>
  </div>;
}
