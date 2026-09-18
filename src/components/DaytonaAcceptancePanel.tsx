"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical, RefreshCw, XCircle } from "lucide-react";

type AcceptanceDeployment = {
  id: number;
  name: string;
  slug: string;
  repository: {
    id: string;
    fullName: string;
    htmlUrl: string;
    private: boolean;
    linkSource: string;
  } | null;
  branch: string;
  revision: string;
  sourceRoot: string;
  validationCommand: string;
  ready: boolean;
  blockers: string[];
};

type AcceptanceResult = {
  ok: boolean;
  deployment: { id: number; slug: string; name: string };
  repository: { fullName: string; private: boolean };
  branch: string;
  revision: string;
  validationCommand: string;
  exactRevisionProved: boolean;
  capabilityHealthy: boolean;
  validationPassed: boolean;
  reproduction: {
    status: string;
    provider: string;
    detail: string;
    reproducedFailure: boolean;
    cleanedUp: boolean;
    logs: string[];
  };
};

export default function DaytonaAcceptancePanel({
  onVerified,
}: {
  onVerified?: () => void | Promise<void>;
}) {
  const [deployments, setDeployments] = useState<AcceptanceDeployment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AcceptanceResult | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/connectors/daytona/acceptance", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Daytona acceptance candidates");
      const items = Array.isArray(data.deployments) ? data.deployments : [];
      setDeployments(items);
      const preferred = items.find((item: AcceptanceDeployment) => item.ready) || items[0];
      if (preferred && !selectedId) {
        setSelectedId(String(preferred.id));
        setCommand(preferred.validationCommand || "");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => deployments.find((item) => String(item.id) === selectedId) || null,
    [deployments, selectedId]
  );

  async function verify() {
    if (!selected) return;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/connectors/daytona/acceptance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deploymentId: selected.id,
          validationCommand: command,
        }),
      });
      const data = await response.json();
      if (!response.ok && !data.reproduction) {
        throw new Error(data.error || "Daytona acceptance failed");
      }
      setResult(data);
      if (data.ok) await onVerified?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center border border-border bg-background text-muted">
            <FlaskConical size={16} />
          </span>
          <div>
            <p className="text-sm font-semibold">Daytona acceptance</p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              Prove that GroundControl can clone an explicitly linked repository at the exact deployed revision, run a bounded validation command, and clean up the sandbox.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || running} className="gc-button gc-button-quiet text-[10px]">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh candidates
        </button>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <label className="block">
            <span className="gc-label">Deployment</span>
            <select
              value={selectedId}
              onChange={(event) => {
                const id = event.target.value;
                setSelectedId(id);
                const item = deployments.find((candidate) => String(candidate.id) === id);
                setCommand(item?.validationCommand || "");
                setResult(null);
              }}
              className="gc-field mt-2 w-full"
            >
              <option value="">Select a deployment</option>
              {deployments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.ready ? "" : " · setup required"}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <div className="space-y-2 border border-border bg-background p-3 font-mono text-[10px] text-muted">
              <p><span className="text-foreground">repository</span> {selected.repository?.fullName || "not linked"}</p>
              <p><span className="text-foreground">link</span> {selected.repository?.linkSource || "none"}</p>
              <p><span className="text-foreground">branch</span> {selected.branch}</p>
              <p className="break-all"><span className="text-foreground">revision</span> {selected.revision || "missing"}</p>
              <p><span className="text-foreground">source root</span> {selected.sourceRoot || "."}</p>
              {selected.blockers.length > 0 && (
                <p className="text-warning">blockers: {selected.blockers.join(", ")}</p>
              )}
            </div>
          )}

          <label className="block">
            <span className="gc-label">Bounded validation command</span>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="npm test"
              className="gc-field mt-2 w-full font-mono"
            />
            <span className="mt-1 block text-[10px] text-muted">
              Allowed commands are limited to project test/build/lint/typecheck and Compose validation.
            </span>
          </label>

          <button
            type="button"
            onClick={() => void verify()}
            disabled={running || !selected?.repository || !selected?.revision || !command.trim()}
            className="gc-button gc-button-primary"
          >
            {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            {running ? "Running isolated verification…" : "Verify exact-revision flow"}
          </button>

          {error && <p className="text-xs text-error">{error}</p>}
        </div>

        <div>
          {!result ? (
            <div className="flex min-h-48 items-center justify-center border border-dashed border-border p-5 text-center text-xs text-muted">
              Run acceptance to produce evidence. Daytona is not marked repository-ready until this succeeds.
            </div>
          ) : (
            <div className={`border p-4 ${result.ok ? "border-success/30 bg-success/5" : "border-error/30 bg-error/5"}`}>
              <div className="flex items-center gap-2">
                {result.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-error" />}
                <p className="text-sm font-medium">{result.ok ? "Exact-revision flow verified" : "Acceptance did not pass"}</p>
              </div>
              <div className="mt-4 space-y-2 text-[11px] text-muted">
                <Evidence label="Provider" value={result.reproduction.provider} ok={result.reproduction.provider === "daytona"} />
                <Evidence label="Exact revision proved" value={result.exactRevisionProved ? "yes" : "no"} ok={result.exactRevisionProved} />
                <Evidence label="Sandbox cleanup" value={result.reproduction.cleanedUp ? "complete" : "not proved"} ok={result.reproduction.cleanedUp} />
                <Evidence label="Validation command" value={result.validationCommand} ok />
                <Evidence label="Validation result" value={result.validationPassed ? "passed" : "failed at exact revision"} ok={result.capabilityHealthy} />
              </div>
              <p className="mt-4 text-[10px] leading-relaxed text-muted">{result.reproduction.detail}</p>
              <p className="mt-3 break-all font-mono text-[9px] text-muted">{result.revision}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Evidence({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span>{label}</span>
      <span className={`max-w-[65%] break-all text-right font-mono ${ok ? "text-success" : "text-warning"}`}>{value}</span>
    </div>
  );
}
