"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Box,
  Braces,
  Network,
  Play,
  RefreshCw,
  RotateCw,
  Square,
} from "lucide-react";
import { ActionConfirm, type ActionType } from "@/components/ActionConfirm";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, Notice, StatusBadge } from "@/components/ui";
import type { ContainerDetail } from "@/lib/container-details";

type ContainerAction = Extract<ActionType, "start" | "stop" | "restart">;

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "GroundControl could not inspect this container.");
  return data;
}

export default function ContainerDetailView({ name }: { name: string }) {
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [logs, setLogs] = useState("");
  const [tail, setTail] = useState(200);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<ContainerAction | null>(null);

  const loadDetail = useCallback(async () => {
    try {
      const response = await fetch(`/api/containers/${encodeURIComponent(name)}`, { cache: "no-store" });
      setDetail(await responseJson(response));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "GroundControl could not inspect this container.");
    } finally {
      setLoading(false);
    }
  }, [name]);

  const loadLogs = useCallback(async (quiet = false) => {
    if (!quiet) setLogsLoading(true);
    try {
      const response = await fetch(
        `/api/containers/logs?name=${encodeURIComponent(name)}&tail=${tail}`,
        { cache: "no-store" }
      );
      const data = await responseJson(response);
      setLogs(String(data.logs || ""));
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : "GroundControl could not load container logs.");
    } finally {
      if (!quiet) setLogsLoading(false);
    }
  }, [name, tail]);

  useEffect(() => {
    void Promise.all([loadDetail(), loadLogs()]);
  }, [loadDetail, loadLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void loadDetail();
      void loadLogs(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadDetail, loadLogs]);

  async function runAction() {
    if (!pendingAction) return;
    const response = await fetch("/api/containers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: pendingAction, name }),
    });
    try {
      await responseJson(response);
      setPendingAction(null);
      await Promise.all([loadDetail(), loadLogs()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The container action failed.");
      setPendingAction(null);
    }
  }

  const isRunning = detail?.state === "running";

  return (
    <div className="gc-page gc-page--wide">
      <Link href="/containers" className="mb-5 inline-flex items-center gap-2 text-xs text-muted hover:text-foreground">
        <ArrowLeft size={14} aria-hidden="true" />
        Runtime
      </Link>

      <PageHeader
        eyebrow="Container"
        title={detail?.name || name}
        description={detail ? detail.image : "Docker runtime details and logs"}
        actions={(
          <>
            <Button
              onClick={() => { void loadDetail(); void loadLogs(); }}
              disabled={loading || logsLoading}
              leadingIcon={<RefreshCw size={14} className={loading || logsLoading ? "animate-spin" : ""} />}
            >
              Refresh
            </Button>
            {detail && (
              isRunning ? (
                <>
                  <Button onClick={() => setPendingAction("restart")} leadingIcon={<RotateCw size={14} />}>Restart</Button>
                  <Button variant="danger" onClick={() => setPendingAction("stop")} leadingIcon={<Square size={13} />}>Stop</Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => setPendingAction("start")} leadingIcon={<Play size={14} />}>Start</Button>
              )
            )}
          </>
        )}
      />

      {error && <Notice tone="danger" title="Container unavailable">{error}</Notice>}

      {!detail && !loading ? (
        <EmptyState
          className="mt-6"
          icon={<Box size={22} />}
          title="Container not found"
          description="It may have been removed or recreated under a different name."
          action={<Button onClick={loadDetail}>Try again</Button>}
        />
      ) : detail ? (
        <div className="space-y-5">
          <section className="grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="State" value={(
              <StatusBadge tone={isRunning ? (detail.health === "unhealthy" ? "warning" : "success") : "danger"}>
                {detail.health || detail.state}
              </StatusBadge>
            )} />
            <Fact label="CPU" value={detail.stats?.cpu || "—"} mono />
            <Fact label="Memory" value={detail.stats?.memory || "—"} mono />
            <Fact label="Restarts" value={String(detail.restartCount)} mono />
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <DetailSection icon={<Box size={15} />} title="Identity">
              <Row label="Container ID" value={detail.id.slice(0, 12)} mono />
              <Row label="Image" value={detail.image} mono />
              <Row label="Image ID" value={shortDigest(detail.imageId)} mono />
              <Row label="Command" value={detail.command || "Image default"} mono />
              <Row label="Restart policy" value={detail.restartPolicy} />
              <Row label="Created" value={dateTime(detail.createdAt)} />
              <Row label="Started" value={dateTime(detail.startedAt)} />
              {!isRunning && <Row label="Exit code" value={String(detail.exitCode)} mono />}
            </DetailSection>

            <DetailSection icon={<Activity size={15} />} title="Runtime">
              <Row label="PID" value={detail.pid ? String(detail.pid) : "—"} mono />
              <Row label="Network I/O" value={detail.stats?.network || "—"} mono />
              <Row label="Block I/O" value={detail.stats?.block || "—"} mono />
              <Row label="Processes" value={detail.stats?.pids || "—"} mono />
              <Row label="OOM killed" value={detail.oomKilled ? "Yes" : "No"} />
              {detail.compose.project && <Row label="Compose project" value={detail.compose.project} mono />}
              {detail.compose.service && <Row label="Compose service" value={detail.compose.service} mono />}
            </DetailSection>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <DetailSection icon={<Network size={15} />} title="Connectivity">
              {detail.ports.length === 0 && detail.networks.length === 0 ? (
                <p className="text-xs text-muted">No published ports or attached networks.</p>
              ) : (
                <>
                  {detail.ports.map((port) => (
                    <Row key={`${port.container}-${port.host}`} label={port.container} value={port.host} mono />
                  ))}
                  {detail.networks.map((network) => (
                    <Row
                      key={network.name}
                      label={network.name}
                      value={[network.ipAddress, network.gateway && `gateway ${network.gateway}`].filter(Boolean).join(" · ") || "attached"}
                      mono
                    />
                  ))}
                </>
              )}
            </DetailSection>

            <DetailSection icon={<Braces size={15} />} title="Configuration">
              <details>
                <summary className="cursor-pointer text-xs font-medium">
                  {detail.environmentKeys.length} injected environment keys
                </summary>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {detail.environmentKeys.map((key) => (
                    <span key={key} className="border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted">
                      {key}
                    </span>
                  ))}
                </div>
              </details>
              {detail.mounts.length > 0 && (
                <details className="mt-4 border-t border-border pt-4">
                  <summary className="cursor-pointer text-xs font-medium">{detail.mounts.length} mounts</summary>
                  <div className="mt-3 space-y-2">
                    {detail.mounts.map((mount) => (
                      <div key={`${mount.source}-${mount.destination}`} className="font-mono text-[10px] leading-relaxed text-muted">
                        {mount.destination} ← {mount.source} · {mount.type}{mount.readOnly ? " · read only" : ""}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </DetailSection>
          </div>

          <section className="border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="gc-eyebrow">Output</p>
                <h2 className="mt-1 text-base font-medium">Logs</h2>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-[10px] text-muted">
                  <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
                  Live
                </label>
                <select
                  value={tail}
                  onChange={(event) => setTail(Number(event.target.value))}
                  className="gc-input h-8 w-24 text-xs"
                  aria-label="Log lines"
                >
                  <option value={100}>100 lines</option>
                  <option value={200}>200 lines</option>
                  <option value={500}>500 lines</option>
                  <option value={1000}>1,000 lines</option>
                </select>
                <Button size="sm" onClick={() => loadLogs()} disabled={logsLoading}>Reload</Button>
              </div>
            </div>
            <pre className="max-h-[520px] min-h-64 overflow-auto whitespace-pre-wrap break-words bg-background/60 p-5 font-mono text-[11px] leading-relaxed text-muted">
              {logsLoading && !logs ? "Loading logs…" : logs || "(no log output)"}
            </pre>
          </section>
        </div>
      ) : null}

      {pendingAction && (
        <ActionConfirm
          open
          action={pendingAction}
          targetName={name}
          targetType="container"
          onConfirm={runAction}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}

function DetailSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4 text-muted">
        {icon}
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      </div>
      <div className="divide-y divide-border px-5">{children}</div>
    </section>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="bg-card px-5 py-4">
      <p className="gc-eyebrow">{label}</p>
      <div className={`mt-2 text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={`min-w-0 break-all text-xs ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}

function shortDigest(value: string) {
  if (!value) return "—";
  return value.length > 24 ? `${value.slice(0, 20)}…${value.slice(-8)}` : value;
}

function dateTime(value: string) {
  if (!value || value.startsWith("0001-")) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
