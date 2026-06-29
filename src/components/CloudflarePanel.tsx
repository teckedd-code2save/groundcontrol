"use client";

import { useEffect, useState } from "react";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { ContainerIcon } from "@/components/TopoIcons";

interface Tunnel {
  id: string;
  name: string;
  dbId?: number;
  connectorStatus?: string;
  connectorId?: string;
}

interface Zone {
  id: string;
  name: string;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

async function fetchTunnels(): Promise<{ tunnels: Tunnel[]; error?: string }> {
  try {
    const res = await fetch("/api/cloudflare/tunnels");
    const data = await res.json();
    if (res.ok) return { tunnels: data.tunnels || [] };
    return { tunnels: [], error: data.error || "Failed to load tunnels" };
  } catch (err) {
    return { tunnels: [], error: err instanceof Error ? err.message : "Failed to load tunnels" };
  }
}

async function fetchZones(): Promise<Zone[]> {
  try {
    const res = await fetch("/api/cloudflare/zones");
    const data = await res.json();
    return data.success ? (data.result as Zone[]) || [] : [];
  } catch {
    return [];
  }
}

async function fetchDns(zoneId: string): Promise<DnsRecord[]> {
  try {
    const res = await fetch(`/api/cloudflare/dns?zoneId=${zoneId}`);
    const data = await res.json();
    return data.success ? (data.result as DnsRecord[]) || [] : [];
  } catch {
    return [];
  }
}

export default function CloudflarePanel() {
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZone, setSelectedZone] = useState<string>("");
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [newTunnelName, setNewTunnelName] = useState("");
  const [loading, setLoading] = useState({ tunnels: true, dns: false });
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [actionLoading, setActionLoading] = useState<{ action: "create" | "delete" | "point"; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading((l) => ({ ...l, tunnels: true }));
      const [tunnelsData, zonesData] = await Promise.all([fetchTunnels(), fetchZones()]);
      if (cancelled) return;
      setTunnels(tunnelsData.tunnels);
      setZones(zonesData);
      if (tunnelsData.error) setError(tunnelsData.error);
      setLoading((l) => ({ ...l, tunnels: false }));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedZone) return;
    let cancelled = false;
    async function loadDns() {
      setLoading((l) => ({ ...l, dns: true }));
      const records = await fetchDns(selectedZone);
      if (cancelled) return;
      setDnsRecords(records);
      setLoading((l) => ({ ...l, dns: false }));
    }
    loadDns();
    return () => {
      cancelled = true;
    };
  }, [selectedZone]);

  async function refreshTunnels() {
    setLoading((l) => ({ ...l, tunnels: true }));
    const data = await fetchTunnels();
    setTunnels(data.tunnels);
    if (data.error) setError(data.error);
    setLoading((l) => ({ ...l, tunnels: false }));
  }

  async function createTunnel() {
    if (!newTunnelName.trim()) return;
    setResult("");
    setError("");
    setActionLoading({ action: "create", name: newTunnelName.trim() });
    try {
      const res = await fetch("/api/cloudflare/tunnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTunnelName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(`Tunnel "${newTunnelName}" created and connector started`);
        setNewTunnelName("");
        await refreshTunnels();
      } else {
        setError(data.error || "Failed to create tunnel");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tunnel");
    } finally {
      setActionLoading(null);
    }
  }

  async function removeTunnel(tunnelId: string) {
    if (!confirm("Stop the connector and delete this tunnel from Cloudflare?")) return;
    setResult("");
    setError("");
    const tunnel = tunnels.find((t) => t.id === tunnelId);
    setActionLoading({ action: "delete", name: tunnel?.name || tunnelId });
    try {
      const res = await fetch(`/api/cloudflare/tunnels?tunnelId=${tunnelId}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setResult("Tunnel deleted");
        await refreshTunnels();
      } else {
        setError(data.error || "Failed to delete tunnel");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete tunnel");
    } finally {
      setActionLoading(null);
    }
  }

  async function pointToTunnel(record: DnsRecord) {
    const tunnel = tunnels.find((t) => t.connectorStatus === "active" || t.connectorStatus === "healthy");
    const content = tunnel ? `${tunnel.id}.cfargotunnel.com` : record.content;
    setResult("");
    setError("");
    setActionLoading({ action: "point", name: record.name });
    try {
      const res = await fetch("/api/cloudflare/dns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId: selectedZone, recordId: record.id, type: "CNAME", name: record.name, content, ttl: record.ttl, proxied: record.proxied }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult(`Updated ${record.name} to point to tunnel`);
        const records = await fetchDns(selectedZone);
        setDnsRecords(records);
      } else {
        setError(data.error || (data.errors || []).map((e: { message?: string }) => e.message).join("; ") || "DNS operation failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNS operation failed");
    } finally {
      setActionLoading(null);
    }
  }

  const overlayOpen = loading.tunnels || loading.dns || !!actionLoading;
  const overlayTitle = actionLoading
    ? `${actionLoading.action === "create" ? "Creating" : actionLoading.action === "delete" ? "Deleting" : "Pointing"} ${actionLoading.name}...`
    : loading.dns
    ? "Loading DNS records..."
    : "Loading tunnels...";

  return (
    <div className="space-y-8">
      <LoaderOverlay3D
        open={overlayOpen}
        variant={loading.dns ? "generic" : "proxy"}
        title={overlayTitle}
      />
      {error && (
        <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs font-mono">
          {error}
        </div>
      )}
      {result && (
        <div className="p-3 bg-success/10 border border-success/30 rounded-lg text-success text-xs font-mono">
          {result}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">Cloudflare Tunnels</h2>
        <div className="flex flex-wrap items-end gap-3 mb-6">
          <input
            type="text"
            placeholder="Tunnel name"
            value={newTunnelName}
            onChange={(e) => setNewTunnelName(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent sm:w-64"
          />
          <button
            onClick={createTunnel}
            disabled={!newTunnelName.trim()}
            className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            Create Tunnel
          </button>
          <button
            onClick={refreshTunnels}
            disabled={loading.tunnels}
            className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {tunnels.length > 0 ? (
          <div className="space-y-3">
            {tunnels.map((tunnel) => (
              <div
                key={tunnel.id}
                className="flex flex-col gap-3 py-3 px-4 rounded-lg border border-border bg-background/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ContainerIcon type="proxy" className="w-4 h-4 text-muted" />
                    <div className="font-medium text-sm">{tunnel.name}</div>
                  </div>
                  <div className="text-xs text-muted font-mono mt-0.5 truncate">
                    {tunnel.id} · connector {tunnel.connectorStatus || "unknown"}
                  </div>
                </div>
                <button
                  onClick={() => removeTunnel(tunnel.id)}
                  className="px-3 py-1.5 text-xs font-mono border border-error/30 text-error rounded hover:bg-error/10 transition-colors"
                >
                  delete
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No tunnels found. Create one above.</p>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">DNS Records</h2>
        <div className="mb-6">
          <label className="block text-xs font-mono text-muted mb-1.5">Zone</label>
          <select
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent sm:w-64"
          >
            <option value="">Select a zone</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        </div>

        {selectedZone && (
          <div className="space-y-3">
            {dnsRecords.length > 0 ? (
              dnsRecords.map((record) => (
                <div
                  key={record.id}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-3 py-3 px-4 rounded-lg border border-border bg-background/50"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{record.name}</div>
                    <div className="text-xs text-muted font-mono mt-0.5 truncate">
                      {record.type} · {record.content} · TTL {record.ttl} · {record.proxied ? "proxied" : "DNS only"}
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto">
                    <button
                      onClick={() => pointToTunnel(record)}
                      disabled={tunnels.length === 0}
                      className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
                      title="Point CNAME to an active tunnel"
                    >
                      point to tunnel
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No DNS records found for this zone.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
