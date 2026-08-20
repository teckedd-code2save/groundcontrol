"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Play, RefreshCw, ScanSearch } from "lucide-react";
import { Button, Notice } from "@/components/ui";

type QACheck = {
  id: number;
  component: string;
  name: string;
  method: string;
  path: string;
  expectedStatus?: number | null;
  expectedBodyContains?: string | null;
  enabled: boolean;
  status: string;
  source?: string;
  evidenceRef?: string | null;
};

type QAResult = {
  checkId: number;
  name: string;
  method: string;
  path: string;
  statusCode?: number;
  passed: boolean;
  error?: string;
};

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export default function ComponentQAPanel({
  deploymentSlug,
  component,
}: {
  deploymentSlug: string;
  component: string;
}) {
  const [checks, setChecks] = useState<QACheck[]>([]);
  const [results, setResults] = useState<QAResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openApiUrl, setOpenApiUrl] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/component-qa?deploymentSlug=${encodeURIComponent(deploymentSlug)}&component=${encodeURIComponent(component)}`
      );
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not load QA checks");
      setChecks(Array.isArray(data.checks) ? data.checks : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [deploymentSlug, component]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeChecks = checks.filter((check) => check.status !== "draft");
  const draftChecks = checks.filter((check) => check.status === "draft");

  async function run() {
    setRunning(true);
    setError(null);
    setResults([]);
    try {
      const response = await fetch("/api/component-qa/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentSlug, component }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "QA run failed");
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function discover() {
    setDiscovering(true);
    setError(null);
    try {
      const response = await fetch("/api/component-qa/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentSlug, component }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Contract discovery failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  }

  async function decide(checkId: number, action: "approve" | "discard") {
    setBusyId(checkId);
    setError(null);
    try {
      const response = await fetch("/api/component-qa/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkId, action }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not update draft");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function importOpenApi() {
    if (!openApiUrl.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/component-qa/import-openapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentSlug, component, openApiUrl: openApiUrl.trim(), save: true }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "OpenAPI import failed");
      await load();
      setOpenApiUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="border border-border bg-card rounded-xl mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="gc-eyebrow">Component QA</p>
          <h2 className="mt-1 text-base font-medium">Feature checks for {component}</h2>
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={discover}
            disabled={discovering || loading}
            leadingIcon={discovering ? <RefreshCw size={13} className="animate-spin" /> : <ScanSearch size={13} />}
          >
            {discovering ? "Discovering…" : "Discover contracts"}
          </Button>
          <Button
            variant="quiet"
            onClick={run}
            disabled={running || loading || activeChecks.length === 0}
            leadingIcon={running ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
          >
            {running ? "Running…" : "Run QA"}
          </Button>
        </div>
      </div>

      {error && <Notice tone="danger" title="QA check failed">{error}</Notice>}

      <div className="px-5 py-4">
        <div className="flex gap-2">
          <input
            value={openApiUrl}
            onChange={(event) => setOpenApiUrl(event.target.value)}
            placeholder="OpenAPI URL, e.g. https://api.example.com/openapi.json"
            className="gc-field min-w-0 flex-1 font-mono"
          />
          <Button onClick={importOpenApi} disabled={importing || !openApiUrl.trim()}>
            {importing ? "Importing…" : "Import OpenAPI"}
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted">
          Imported operations, source routes, and live snapshots become reviewable contracts.
        </p>
      </div>

      {draftChecks.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <p className="text-xs font-semibold text-muted">Pending review ({draftChecks.length})</p>
          <div className="mt-2 space-y-2">
            {draftChecks.map((check) => (
              <div key={check.id} className="flex items-start justify-between gap-3 rounded border border-border bg-background px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{check.name}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted">
                    {check.method} {check.path} · expected {check.expectedStatus || "any status"}
                  </p>
                  {check.source && (
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      {check.source}
                      {check.evidenceRef ? ` · ${check.evidenceRef}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="quiet" disabled={busyId === check.id} onClick={() => decide(check.id, "approve")}>
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" disabled={busyId === check.id} onClick={() => decide(check.id, "discard")}>
                    Discard
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="divide-y divide-border border-t border-border">
        {activeChecks.length === 0 ? (
          <p className="px-5 py-5 text-xs text-muted">
            {checks.length === 0 ? "No QA checks configured for this component." : "No active checks yet — review drafts above."}
          </p>
        ) : (
          activeChecks.map((check) => (
            <div key={check.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-xs font-medium">{check.name}</p>
                <p className="mt-1 font-mono text-[10px] text-muted">
                  {check.method} {check.path} · expected {check.expectedStatus || "any status"}
                </p>
              </div>
              <span className={`shrink-0 font-mono text-[10px] ${check.enabled ? "text-success" : "text-muted"}`}>
                {check.enabled ? "active" : "disabled"}
              </span>
            </div>
          ))
        )}
      </div>

      {results.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <p className="text-xs font-semibold">Last QA run</p>
          <div className="mt-2 space-y-2">
            {results.map((result, index) => (
              <div key={`${result.checkId}-${index}`} className="rounded border border-border bg-background px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] text-muted">{result.method} {result.path}</span>
                  <span className={`font-mono text-[10px] ${result.passed ? "text-success" : "text-error"}`}>
                    {result.passed ? "passed" : result.error || `status ${result.statusCode || "n/a"}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {results.some((result) => !result.passed) && (
            <Link
              href={`/intelligence?deployment=${encodeURIComponent(deploymentSlug)}&component=${encodeURIComponent(component)}&mode=component-qa`}
              className="gc-button mt-3"
            >
              Investigate component QA
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
